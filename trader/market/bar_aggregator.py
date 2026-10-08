from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Deque, Dict, List, Optional, Sequence

from market.bars import Bar
from models.types import Quote

MAX_MINUTE_BARS = 120


@dataclass
class MinuteBar:
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    synthetic: bool = False
    # Real IBKR 1-min history: counts for price indicators, not for volume ratio
    # (historical volume and live tick volume increments may use different units).
    seeded: bool = False


def _ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _minute_bucket(ts: datetime) -> datetime:
    ts = _ensure_utc(ts)
    return ts.replace(second=0, microsecond=0)


class MinuteBarAggregator:
    """Rolling 1-minute OHLCV bars from live ticks, bootstrapped from 5-min cache."""

    def __init__(self, max_bars: int = MAX_MINUTE_BARS) -> None:
        self.max_bars = max_bars
        self._bars: Deque[MinuteBar] = deque(maxlen=max_bars)
        self._current_bucket: Optional[datetime] = None
        self._current: Optional[MinuteBar] = None
        self._last_seen_volume: Optional[int] = None
        # First live tick minute; None until record_point runs after bootstrap/start.
        self._live_from: Optional[datetime] = None
        self._lock = threading.Lock()

    def bootstrap_from_five_min_bars(self, bars: Sequence[Bar]) -> None:
        """Seed 1-min history by expanding each 5-min bar into five 1-min placeholders."""
        with self._lock:
            self._bars.clear()
            self._current_bucket = None
            self._current = None
            self._last_seen_volume = None
            self._live_from = None

            for bar in sorted(bars, key=lambda item: item.ts):
                ts = _ensure_utc(bar.ts)
                close = bar.close
                minute_vol = max(int(bar.volume // 5), 0)
                for offset in range(5):
                    bucket = ts + timedelta(minutes=offset)
                    self._bars.append(
                        MinuteBar(
                            ts=bucket,
                            open=close,
                            high=close,
                            low=close,
                            close=close,
                            volume=minute_vol,
                            synthetic=True,
                        )
                    )

    def bootstrap_from_minute_bars(self, bars: Sequence[Bar]) -> None:
        """Replace placeholder history with real 1-min bars older than any live tick."""
        with self._lock:
            live = [bar for bar in self._bars if not bar.synthetic and not bar.seeded]
            if live:
                cutoff: Optional[datetime] = _ensure_utc(live[0].ts)
            elif self._current is not None:
                cutoff = _ensure_utc(self._current.ts)
            else:
                cutoff = None
            history = [
                MinuteBar(
                    ts=_ensure_utc(bar.ts),
                    open=bar.open,
                    high=bar.high,
                    low=bar.low,
                    close=bar.close,
                    volume=max(int(bar.volume), 0),
                    seeded=True,
                )
                for bar in sorted(bars, key=lambda item: item.ts)
                if cutoff is None or _ensure_utc(bar.ts) < cutoff
            ]
            self._bars.clear()
            self._bars.extend(history + live)

    def _volume_increment(self, volume: int) -> int:
        """Convert IBKR cumulative session volume into per-tick increment."""
        if volume <= 0:
            return 0
        if self._last_seen_volume is None:
            self._last_seen_volume = volume
            return 0
        if volume >= self._last_seen_volume:
            delta = volume - self._last_seen_volume
            self._last_seen_volume = volume
            return delta
        # Session reset or non-cumulative source (mock quotes).
        self._last_seen_volume = volume
        return max(volume // 1000, 1)

    def record_point(self, ts: datetime, price: float, volume: int = 0) -> None:
        with self._lock:
            increment = self._volume_increment(volume)
            bucket = _minute_bucket(ts)
            if self._live_from is None:
                self._live_from = bucket
            if self._current is None or self._current_bucket != bucket:
                if self._current is not None:
                    self._bars.append(self._current)
                self._current_bucket = bucket
                self._current = MinuteBar(
                    ts=bucket,
                    open=price,
                    high=price,
                    low=price,
                    close=price,
                    volume=increment,
                    synthetic=False,
                )
                return

            bar = self._current
            bar.high = max(bar.high, price)
            bar.low = min(bar.low, price)
            bar.close = price
            bar.volume += increment

    def record(self, quote: Quote, ts: Optional[datetime] = None) -> None:
        if quote.price is None:
            return
        tick_ts = ts or datetime.now(timezone.utc)
        self.record_point(tick_ts, quote.price, quote.volume or 0)

    def completed_bars(self) -> List[MinuteBar]:
        with self._lock:
            return list(self._bars)

    def all_bars(self) -> List[MinuteBar]:
        """Completed minute bars plus the in-progress bucket (if any)."""
        with self._lock:
            bars = list(self._bars)
            if self._current is not None:
                bars.append(self._current)
            return bars

    def has_live_ticks(self) -> bool:
        with self._lock:
            return self._live_from is not None

    def live_from(self) -> Optional[datetime]:
        with self._lock:
            return self._live_from

    def live_minute_bars(self) -> List[MinuteBar]:
        """Minute bars at/after the first live tick (excludes bootstrap-only history)."""
        with self._lock:
            if self._live_from is None:
                return []
            live_from = self._live_from
            bars = list(self._bars)
            if self._current is not None:
                bars.append(self._current)
            return [bar for bar in bars if _ensure_utc(bar.ts) >= live_from]

    def closes(self, live_price: Optional[float] = None) -> List[float]:
        with self._lock:
            closes = [bar.close for bar in self._bars]
            if self._current is not None:
                closes.append(live_price if live_price is not None else self._current.close)
            return closes

    def volumes(self) -> List[int]:
        with self._lock:
            volumes = [bar.volume for bar in self._bars]
            if self._current is not None:
                volumes.append(self._current.volume)
            return volumes

    def change_pct(self, minutes: int, live_price: Optional[float] = None) -> Optional[float]:
        with self._lock:
            closes = [bar.close for bar in self._bars]
            if self._current is not None:
                closes.append(live_price if live_price is not None else self._current.close)
            if len(closes) <= minutes:
                return None
            past = closes[-1 - minutes]
            current = closes[-1]
            if past == 0:
                return None
            return round((current - past) / past * 100, 4)

    def bar_count(self) -> int:
        with self._lock:
            count = len(self._bars)
            if self._current is not None:
                count += 1
            return count

    def is_ready(self, min_bars: int) -> bool:
        return self.bar_count() >= min_bars

    def live_bar_count(self) -> int:
        """Count non-synthetic minute bars (live ticks only)."""
        with self._lock:
            count = sum(1 for bar in self._bars if not bar.synthetic)
            if self._current is not None and not self._current.synthetic:
                count += 1
            return count

    def live_closes(self, live_price: Optional[float] = None) -> List[float]:
        with self._lock:
            closes = [bar.close for bar in self._bars if not bar.synthetic]
            if self._current is not None and not self._current.synthetic:
                closes.append(
                    live_price if live_price is not None else self._current.close
                )
            return closes

    def live_volumes(self) -> List[int]:
        with self._lock:
            volumes = [
                bar.volume for bar in self._bars if not bar.synthetic and not bar.seeded
            ]
            if self._current is not None and not self._current.synthetic:
                volumes.append(self._current.volume)
            return volumes


class MinuteBarStore:
    """Minute bar aggregators keyed by symbol."""

    def __init__(self, symbols: Sequence[str], max_bars: int = MAX_MINUTE_BARS) -> None:
        self._max_bars = max_bars
        self._aggregators: Dict[str, MinuteBarAggregator] = {
            symbol.upper(): MinuteBarAggregator(max_bars=max_bars)
            for symbol in symbols
        }
        self._store_lock = threading.Lock()

    def ensure_symbol(self, symbol: str) -> MinuteBarAggregator:
        key = symbol.upper()
        with self._store_lock:
            if key not in self._aggregators:
                self._aggregators[key] = MinuteBarAggregator(max_bars=self._max_bars)
            return self._aggregators[key]

    def get(self, symbol: str) -> MinuteBarAggregator:
        return self.ensure_symbol(symbol)

    def record(self, quote: Quote) -> None:
        self.ensure_symbol(quote.symbol).record(quote)
