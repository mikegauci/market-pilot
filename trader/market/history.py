from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Deque, Dict, List, Optional, Tuple

from models.types import Quote

PricePoint = Tuple[datetime, float, int]


@dataclass
class PriceHistory:
    """Rolling in-memory price history for one symbol."""

    max_minutes: int = 20

    def __post_init__(self) -> None:
        self._points: Deque[PricePoint] = deque()

    def record_point(self, ts: datetime, price: float, volume: int = 0) -> None:
        self._points.append((ts, price, volume))
        self._trim(ts)

    def record(self, quote: Quote) -> None:
        if quote.price is None:
            return
        now = datetime.now(timezone.utc)
        volume = quote.volume or 0
        self.record_point(now, quote.price, volume)

    def _trim(self, now: datetime) -> None:
        cutoff_minutes = self.max_minutes
        while self._points:
            age = (now - self._points[0][0]).total_seconds() / 60.0
            if age > cutoff_minutes:
                self._points.popleft()
            else:
                break

    def change_pct(self, minutes: float) -> Optional[float]:
        if not self._points:
            return None
        now = self._points[-1][0]
        current = self._points[-1][1]
        target_time = now.timestamp() - minutes * 60
        past_price: Optional[float] = None
        for ts, price, _ in self._points:
            if ts.timestamp() <= target_time:
                past_price = price
            else:
                break
        if past_price is None or past_price == 0:
            return None
        return round((current - past_price) / past_price * 100, 4)

    def prices(self) -> List[float]:
        return [p[1] for p in self._points]

    def volumes(self) -> List[int]:
        return [p[2] for p in self._points]

    def has_minutes(self, minutes: float) -> bool:
        if len(self._points) < 2:
            return False
        span = (self._points[-1][0] - self._points[0][0]).total_seconds() / 60.0
        return span >= minutes

    def is_ready(self, min_samples: int = 15, min_span_sec: float = 30.0) -> bool:
        if len(self._points) < min_samples:
            return False
        span_sec = (self._points[-1][0] - self._points[0][0]).total_seconds()
        return span_sec >= min_span_sec


class HistoryStore:
    """Price history buffers keyed by symbol."""

    def __init__(self, symbols: List[str], max_minutes: int = 20) -> None:
        self._histories: Dict[str, PriceHistory] = {
            symbol: PriceHistory(max_minutes=max_minutes) for symbol in symbols
        }

    def ensure_symbol(self, symbol: str) -> None:
        if symbol not in self._histories:
            self._histories[symbol] = PriceHistory()

    def record(self, quote: Quote) -> None:
        self.ensure_symbol(quote.symbol)
        self._histories[quote.symbol].record(quote)

    def get(self, symbol: str) -> PriceHistory:
        self.ensure_symbol(symbol)
        return self._histories[symbol]
