from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Protocol, Sequence

from typing import TYPE_CHECKING

from market.history import HistoryStore
from models.types import Quote

if TYPE_CHECKING:
    from market.bar_aggregator import MinuteBarAggregator

logger = logging.getLogger(__name__)

BAR_SIZE_DAILY = "1 day"
BAR_SIZE_INTRADAY = "5 mins"
MIN_INTRADAY_BARS = 30


@dataclass(frozen=True)
class Bar:
    symbol: str
    bar_size: str
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass
class TrendChanges:
    change_1d: Optional[float] = None
    change_5d: Optional[float] = None
    change_1w: Optional[float] = None


class BarRepository(Protocol):
    def get_bars(self, symbol: str, bar_size: str) -> List[Bar]: ...

    def upsert_bars(self, bars: Sequence[Bar]) -> None: ...

    def get_last_fetched_at(self, symbol: str, bar_size: str) -> Optional[datetime]: ...

    def set_last_fetched_at(self, symbol: str, bar_size: str, fetched_at: datetime) -> None: ...


def _ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def compute_trend_changes(daily_bars: Sequence[Bar]) -> TrendChanges:
    """Compute 1d/5d/1w % change from sorted daily closes."""
    if not daily_bars:
        return TrendChanges()
    closes = [bar.close for bar in sorted(daily_bars, key=lambda b: b.ts)]
    current = closes[-1]

    def pct(days_back: int) -> Optional[float]:
        if len(closes) <= days_back or closes[-1 - days_back] == 0:
            return None
        past = closes[-1 - days_back]
        return round((current - past) / past * 100, 4)

    change_1w = None
    if len(closes) > 1 and closes[0] != 0:
        change_1w = round((current - closes[0]) / closes[0] * 100, 4)

    return TrendChanges(
        change_1d=pct(1),
        change_5d=pct(min(5, len(closes) - 1)) if len(closes) > 1 else None,
        change_1w=change_1w,
    )


def seed_history_from_intraday_bars(store: HistoryStore, bars: Sequence[Bar]) -> None:
    """Seed rolling history from cached 5-min bars for instant Jev warm-up."""
    if not bars:
        return
    symbol = bars[0].symbol.upper()
    history = store.get(symbol)
    for bar in sorted(bars, key=lambda b: b.ts):
        ts = _ensure_utc(bar.ts)
        history.record_point(ts, bar.close, bar.volume)


class BarStore:
    """Cache-first bar access with optional IBKR backfill."""

    def __init__(
        self,
        repository: BarRepository,
        *,
        daily_duration: str = "1 W",
        intraday_duration: str = "3 D",
        backfill_pacing_sec: float = 12.0,
    ) -> None:
        self.repository = repository
        self.daily_duration = daily_duration
        self.intraday_duration = intraday_duration
        self.backfill_pacing_sec = backfill_pacing_sec
        self._trend_cache: Dict[str, TrendChanges] = {}

    def get_daily_bars(self, symbol: str) -> List[Bar]:
        return self.repository.get_bars(symbol.upper(), BAR_SIZE_DAILY)

    def get_intraday_bars(self, symbol: str) -> List[Bar]:
        return self.repository.get_bars(symbol.upper(), BAR_SIZE_INTRADAY)

    def get_trend_changes(self, symbol: str) -> TrendChanges:
        key = symbol.upper()
        if key not in self._trend_cache:
            self._trend_cache[key] = compute_trend_changes(self.get_daily_bars(key))
        return self._trend_cache[key]

    def invalidate_trend_cache(self, symbol: Optional[str] = None) -> None:
        if symbol is None:
            self._trend_cache.clear()
            return
        self._trend_cache.pop(symbol.upper(), None)

    def seed_history_store(self, store: HistoryStore, symbol: str) -> None:
        bars = self.get_intraday_bars(symbol)
        if bars:
            seed_history_from_intraday_bars(store, bars)

    def seed_minute_aggregator(self, aggregator: "MinuteBarAggregator", symbol: str) -> None:
        if aggregator.bar_count() > 0:
            return
        bars = self.get_intraday_bars(symbol)
        if bars:
            aggregator.bootstrap_from_five_min_bars(bars)

    def intraday_coverage(
        self,
        symbols: Sequence[str],
        min_bars: int = MIN_INTRADAY_BARS,
    ) -> float:
        if not symbols:
            return 0.0
        ready = sum(
            1 for symbol in symbols if len(self.get_intraday_bars(symbol)) >= min_bars
        )
        return ready / len(symbols)

    def needs_daily_refresh(self, symbol: str, now: Optional[datetime] = None) -> bool:
        now = now or datetime.now(timezone.utc)
        last = self.repository.get_last_fetched_at(symbol.upper(), BAR_SIZE_DAILY)
        if last is None:
            return True
        last = _ensure_utc(last)
        return last.date() < now.date()

    def needs_intraday_refresh(self, symbol: str, now: Optional[datetime] = None) -> bool:
        now = now or datetime.now(timezone.utc)
        last = self.repository.get_last_fetched_at(symbol.upper(), BAR_SIZE_INTRADAY)
        if last is None:
            return True
        last = _ensure_utc(last)
        return (now - last) >= timedelta(hours=4)

    def backfill_symbol(
        self,
        symbol: str,
        fetcher: object,
        *,
        force: bool = False,
    ) -> bool:
        """Fetch missing bar sizes from IBKR and persist. Returns True if any fetch ran."""
        from broker.ibkr import IBKRClient

        if not isinstance(fetcher, IBKRClient) or not fetcher.is_connected():
            return False

        symbol = symbol.upper()
        fetched = False
        now = datetime.now(timezone.utc)

        if force or self.needs_daily_refresh(symbol, now):
            daily = fetcher.fetch_historical_bars(
                symbol,
                duration=self.daily_duration,
                bar_size=BAR_SIZE_DAILY,
            )
            if daily:
                self.repository.upsert_bars(daily)
                self.invalidate_trend_cache(symbol)
                self.repository.set_last_fetched_at(symbol, BAR_SIZE_DAILY, now)
                fetched = True
            else:
                logger.warning(
                    "No daily bars returned for %s — will retry on next backfill",
                    symbol,
                )
            if self.backfill_pacing_sec > 0:
                time.sleep(min(self.backfill_pacing_sec, 5.0))

        if force or self.needs_intraday_refresh(symbol, now):
            intraday = fetcher.fetch_historical_bars(
                symbol,
                duration=self.intraday_duration,
                bar_size=BAR_SIZE_INTRADAY,
            )
            if intraday:
                self.repository.upsert_bars(intraday)
                self.repository.set_last_fetched_at(symbol, BAR_SIZE_INTRADAY, now)
                fetched = True
            else:
                logger.warning(
                    "No intraday bars returned for %s — will retry on next backfill",
                    symbol,
                )

        return fetched

    def backfill_universe(
        self,
        symbols: Sequence[str],
        fetcher: object,
        *,
        force: bool = False,
        pacing_sec: Optional[float] = None,
    ) -> int:
        """Paced backfill for many symbols. Returns count of symbols fetched."""
        import time

        delay = pacing_sec if pacing_sec is not None else self.backfill_pacing_sec
        count = 0
        for index, symbol in enumerate(symbols):
            if self.backfill_symbol(symbol, fetcher, force=force):
                count += 1
            if index < len(symbols) - 1 and delay > 0:
                time.sleep(delay)
        return count
