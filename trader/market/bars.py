from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Protocol, Sequence, Tuple

from typing import TYPE_CHECKING

from market.hours import is_us_regular_session_open, trading_calendar_date
from models.types import Quote

if TYPE_CHECKING:
    from market.bar_aggregator import MinuteBar, MinuteBarAggregator, MinuteBarStore

logger = logging.getLogger(__name__)

BAR_SIZE_DAILY = "1 day"
BAR_SIZE_INTRADAY = "5 mins"
MIN_INTRADAY_BARS = 30
INTRADAY_FRESHNESS = timedelta(hours=4)
INTRADAY_LIVE_BAR_FRESHNESS = timedelta(minutes=30)
OPEN_POSITION_INTRADAY_FRESHNESS = timedelta(minutes=5)


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


@dataclass(frozen=True)
class BackfillSymbolResult:
    symbol: str
    status: str
    daily_bars: int = 0
    intraday_bars: int = 0
    message: str = ""

    @property
    def refreshed(self) -> bool:
        return self.status == "refreshed"


@dataclass(frozen=True)
class BackfillSummary:
    results: List[BackfillSymbolResult]

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def refreshed(self) -> int:
        return sum(1 for item in self.results if item.refreshed)

    @property
    def unqualified_symbols(self) -> List[str]:
        return [item.symbol for item in self.results if item.status == "unqualified"]

    @property
    def no_bars_symbols(self) -> List[str]:
        return [item.symbol for item in self.results if item.status == "no_bars"]


class BarRepository(Protocol):
    def get_bars(self, symbol: str, bar_size: str) -> List[Bar]: ...

    def upsert_bars(self, bars: Sequence[Bar]) -> None: ...

    def get_last_fetched_at(self, symbol: str, bar_size: str) -> Optional[datetime]: ...

    def set_last_fetched_at(self, symbol: str, bar_size: str, fetched_at: datetime) -> None: ...

    def get_latest_bar_ts(self, symbol: str, bar_size: str) -> Optional[datetime]: ...

    def count_bars(self, symbol: str, bar_size: str) -> int: ...


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


def _five_min_bucket(ts: datetime) -> datetime:
    ts = _ensure_utc(ts)
    return ts.replace(minute=(ts.minute // 5) * 5, second=0, microsecond=0)


def _first_full_live_five_min_bucket(live_from: datetime) -> datetime:
    """Earliest 5m bucket composed only of post-live minutes (avoids partial overwrite)."""
    live_from = _ensure_utc(live_from)
    bucket = _five_min_bucket(live_from)
    if live_from == bucket:
        return bucket
    return bucket + timedelta(minutes=5)


def rollup_minute_bars_to_five_min(
    symbol: str,
    minute_bars: Sequence["MinuteBar"],
) -> List[Bar]:
    """Aggregate 1-minute OHLCV into 5-minute bars for chart persistence."""
    buckets: Dict[datetime, List["MinuteBar"]] = {}
    for minute_bar in minute_bars:
        bucket = _five_min_bucket(minute_bar.ts)
        buckets.setdefault(bucket, []).append(minute_bar)

    rolled: List[Bar] = []
    for bucket_ts in sorted(buckets):
        group = buckets[bucket_ts]
        rolled.append(
            Bar(
                symbol=symbol.upper(),
                bar_size=BAR_SIZE_INTRADAY,
                ts=bucket_ts,
                open=group[0].open,
                high=max(item.high for item in group),
                low=min(item.low for item in group),
                close=group[-1].close,
                volume=sum(item.volume for item in group),
            )
        )
    return rolled


def live_five_min_bars_for_flush(
    symbol: str,
    aggregator: "MinuteBarAggregator",
) -> List[Bar]:
    """Roll only fully live 5m buckets so bootstrap placeholders never overwrite IBKR OHLC."""
    live_from = aggregator.live_from()
    if live_from is None:
        return []
    live_minutes = aggregator.live_minute_bars()
    if not live_minutes:
        return []
    rolled = rollup_minute_bars_to_five_min(symbol, live_minutes)
    if not rolled:
        return []
    first_safe = _first_full_live_five_min_bucket(live_from)
    return [bar for bar in rolled if bar.ts >= first_safe]


MAX_FLUSHED_BAR_CACHE = 20_000


def _bar_values(bar: Bar) -> Tuple[float, ...]:
    return (bar.open, bar.high, bar.low, bar.close, float(bar.volume))


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
        self._bar_cache: Dict[Tuple[str, str], List[Bar]] = {}
        # Last OHLCV written per live 5m bar, so each flush only sends bars that changed.
        self._flushed_bar_values: Dict[Tuple[str, datetime], Tuple[float, ...]] = {}

    def _cache_key(self, symbol: str, bar_size: str) -> Tuple[str, str]:
        return (symbol.upper(), bar_size)

    def _get_cached_bars(self, symbol: str, bar_size: str) -> List[Bar]:
        key = self._cache_key(symbol, bar_size)
        cached = self._bar_cache.get(key)
        if cached is not None:
            return cached
        bars = self.repository.get_bars(symbol.upper(), bar_size)
        self._bar_cache[key] = bars
        return bars

    def invalidate_bar_cache(
        self,
        symbol: Optional[str] = None,
        bar_size: Optional[str] = None,
    ) -> None:
        if symbol is None:
            self._bar_cache.clear()
            return
        symbol_key = symbol.upper()
        if bar_size is None:
            for key in list(self._bar_cache):
                if key[0] == symbol_key:
                    self._bar_cache.pop(key, None)
            return
        self._bar_cache.pop(self._cache_key(symbol_key, bar_size), None)

    def get_daily_bars(self, symbol: str) -> List[Bar]:
        return self._get_cached_bars(symbol, BAR_SIZE_DAILY)

    def get_intraday_bars(self, symbol: str) -> List[Bar]:
        return self._get_cached_bars(symbol, BAR_SIZE_INTRADAY)

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

    def seed_minute_aggregator(self, aggregator: "MinuteBarAggregator", symbol: str) -> None:
        if aggregator.live_bar_count() > 0:
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

    def intraday_bar_count(self, symbol: str) -> int:
        symbol = symbol.upper()
        count = self.repository.count_bars(symbol, BAR_SIZE_INTRADAY)
        if count > 0:
            return count
        return len(self.get_intraday_bars(symbol))

    def latest_intraday_bar_ts(self, symbol: str) -> Optional[datetime]:
        symbol = symbol.upper()
        latest = self.repository.get_latest_bar_ts(symbol, BAR_SIZE_INTRADAY)
        if latest is not None:
            return _ensure_utc(latest)
        bars = self.get_intraday_bars(symbol)
        if not bars:
            return None
        return _ensure_utc(max(bar.ts for bar in bars))

    def intraday_cache_is_fresh(
        self,
        symbol: str,
        now: Optional[datetime] = None,
        *,
        max_age: Optional[timedelta] = None,
    ) -> bool:
        """True when stored 5m bars are recent enough to skip an IBKR historical refetch."""
        now = now or datetime.now(timezone.utc)
        symbol = symbol.upper()
        if self.intraday_bar_count(symbol) < MIN_INTRADAY_BARS:
            return False
        latest = self.latest_intraday_bar_ts(symbol)
        if latest is None:
            return False
        bar_age = now - latest
        if is_us_regular_session_open(now):
            limit = max_age if max_age is not None else INTRADAY_LIVE_BAR_FRESHNESS
            return bar_age < limit
        latest_day = trading_calendar_date(latest)
        if latest_day != trading_calendar_date(now):
            return False
        limit = max_age if max_age is not None else INTRADAY_FRESHNESS
        return bar_age < limit

    def needs_intraday_refresh(
        self,
        symbol: str,
        now: Optional[datetime] = None,
        *,
        max_age: Optional[timedelta] = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        if self.intraday_cache_is_fresh(symbol, now, max_age=max_age):
            return False
        last = self.repository.get_last_fetched_at(symbol.upper(), BAR_SIZE_INTRADAY)
        if last is None:
            return True
        last = _ensure_utc(last)
        age = max_age if max_age is not None else INTRADAY_FRESHNESS
        return (now - last) >= age

    def needs_backfill(
        self,
        symbol: str,
        now: Optional[datetime] = None,
        *,
        intraday_max_age: Optional[timedelta] = None,
    ) -> bool:
        symbol = symbol.upper()
        return self.needs_daily_refresh(symbol, now) or self.needs_intraday_refresh(
            symbol, now, max_age=intraday_max_age
        )

    def symbols_needing_backfill(
        self,
        symbols: Sequence[str],
        now: Optional[datetime] = None,
        *,
        intraday_max_age: Optional[timedelta] = None,
    ) -> List[str]:
        return [
            symbol.upper()
            for symbol in symbols
            if symbol
            and self.needs_backfill(
                symbol.upper(), now, intraday_max_age=intraday_max_age
            )
        ]

    def flush_live_intraday_bars(
        self,
        symbols: Sequence[str],
        minute_bars: "MinuteBarStore",
    ) -> int:
        """Upsert live-only 5m bars so the intraday cache tracks the session (never marks historical fetch)."""
        pending: List[Bar] = []
        flushed_symbols: List[str] = []
        for symbol in dict.fromkeys(s.upper() for s in symbols if s):
            aggregator = minute_bars.get(symbol)
            if not aggregator.has_live_ticks():
                continue
            changed = [
                bar
                for bar in live_five_min_bars_for_flush(symbol, aggregator)
                if self._flushed_bar_values.get((bar.symbol, bar.ts)) != _bar_values(bar)
            ]
            if not changed:
                continue
            pending.extend(changed)
            flushed_symbols.append(symbol)
        if not pending:
            return 0
        self.repository.upsert_bars(pending)
        if len(self._flushed_bar_values) > MAX_FLUSHED_BAR_CACHE:
            self._evict_old_flushed_bars(max(bar.ts for bar in pending))
        for bar in pending:
            self._flushed_bar_values[(bar.symbol, bar.ts)] = _bar_values(bar)
        for symbol in flushed_symbols:
            self.invalidate_bar_cache(symbol, BAR_SIZE_INTRADAY)
        return len(flushed_symbols)

    def _evict_old_flushed_bars(self, newest_ts: datetime) -> None:
        """Drop bars from earlier sessions; they are never rewritten, so tracking them is waste."""
        cutoff = newest_ts - timedelta(days=1)
        self._flushed_bar_values = {
            key: values for key, values in self._flushed_bar_values.items() if key[1] >= cutoff
        }

    def backfill_symbol(
        self,
        symbol: str,
        fetcher: object,
        *,
        force: bool = False,
    ) -> BackfillSymbolResult:
        """Fetch missing bar sizes from IBKR and persist."""
        from broker.ibkr import IBKRClient

        symbol = symbol.upper()
        if not isinstance(fetcher, IBKRClient) or not fetcher.is_connected():
            return BackfillSymbolResult(symbol, "disconnected", message="IBKR not connected")

        if not fetcher.can_trade_symbol(symbol):
            return BackfillSymbolResult(
                symbol,
                "unqualified",
                message="Could not qualify as SMART/USD",
            )

        now = datetime.now(timezone.utc)
        needs_daily = force or self.needs_daily_refresh(symbol, now)
        needs_intraday = force or self.needs_intraday_refresh(symbol, now)
        if not needs_daily and not needs_intraday:
            return BackfillSymbolResult(symbol, "skipped_fresh", message="Cache still fresh")

        daily_count = 0
        intraday_count = 0
        fetched = False

        if needs_daily:
            daily = fetcher.fetch_historical_bars(
                symbol,
                duration=self.daily_duration,
                bar_size=BAR_SIZE_DAILY,
            )
            daily_count = len(daily)
            if daily:
                self.repository.upsert_bars(daily)
                self.invalidate_trend_cache(symbol)
                self.invalidate_bar_cache(symbol, BAR_SIZE_DAILY)
                self.repository.set_last_fetched_at(symbol, BAR_SIZE_DAILY, now)
                fetched = True
            else:
                logger.warning(
                    "No daily bars returned for %s — will retry on next backfill",
                    symbol,
                )
            if self.backfill_pacing_sec > 0:
                time.sleep(min(self.backfill_pacing_sec, 5.0))

        skip_intraday = needs_daily and daily_count == 0
        if skip_intraday and needs_intraday:
            logger.info(
                "Skipping intraday backfill for %s — daily history unavailable",
                symbol,
            )

        if needs_intraday and not skip_intraday:
            intraday = fetcher.fetch_historical_bars(
                symbol,
                duration=self.intraday_duration,
                bar_size=BAR_SIZE_INTRADAY,
            )
            intraday_count = len(intraday)
            if intraday:
                self.repository.upsert_bars(intraday)
                self.invalidate_bar_cache(symbol, BAR_SIZE_INTRADAY)
                self.repository.set_last_fetched_at(symbol, BAR_SIZE_INTRADAY, now)
                fetched = True
            else:
                logger.warning(
                    "No intraday bars returned for %s — will retry on next backfill",
                    symbol,
                )

        if fetched:
            return BackfillSymbolResult(
                symbol,
                "refreshed",
                daily_bars=daily_count,
                intraday_bars=intraday_count,
            )
        return BackfillSymbolResult(
            symbol,
            "no_bars",
            daily_bars=daily_count,
            intraday_bars=intraday_count,
            message="IBKR returned no bars",
        )

    def backfill_universe(
        self,
        symbols: Sequence[str],
        fetcher: object,
        *,
        force: bool = False,
        pacing_sec: Optional[float] = None,
        on_progress: Optional[Callable[[BackfillSymbolResult, int, int], None]] = None,
    ) -> BackfillSummary:
        """Paced backfill for many symbols."""
        delay = pacing_sec if pacing_sec is not None else self.backfill_pacing_sec
        results: List[BackfillSymbolResult] = []
        total = len(symbols)
        for index, symbol in enumerate(symbols):
            result = self.backfill_symbol(symbol, fetcher, force=force)
            results.append(result)
            if on_progress is not None:
                on_progress(result, index + 1, total)
            if (
                index < total - 1
                and delay > 0
                and result.status not in ("skipped_fresh", "unqualified", "disconnected")
            ):
                time.sleep(delay)
        return BackfillSummary(results=results)
