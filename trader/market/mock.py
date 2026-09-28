from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from market.history import HistoryStore
from models.types import Quote

# Seeded base prices for reproducible mock data
BASE_PRICES: Dict[str, float] = {
    "SPY": 580.0,
    "QQQ": 500.0,
    "NVDA": 180.0,
    "AAPL": 230.0,
    "MSFT": 420.0,
    "AMD": 160.0,
    "META": 580.0,
}

DEFAULT_BASE = 100.0


class MockMarketProvider:
    """Synthetic random-walk quotes for development without IBKR."""

    def __init__(self, symbols: List[str], seed: int = 42) -> None:
        self.symbols = symbols
        self._rng = random.Random(seed)
        self._prices: Dict[str, float] = {}
        for symbol in symbols:
            self._prices[symbol] = BASE_PRICES.get(symbol, DEFAULT_BASE)

    def get_quotes(self) -> List[Quote]:
        quotes: List[Quote] = []
        for symbol in self.symbols:
            price = self._prices[symbol]
            # Small random walk: +/- 0.05%
            delta_pct = self._rng.uniform(-0.0005, 0.0005)
            price = max(0.01, price * (1 + delta_pct))
            self._prices[symbol] = price

            spread_pct = self._rng.uniform(0.0002, 0.0005)
            half_spread = price * spread_pct / 2
            bid = round(price - half_spread, 4)
            ask = round(price + half_spread, 4)
            spread = round(ask - bid, 4)
            volume = self._rng.randint(500_000, 2_000_000)

            quotes.append(
                Quote(
                    symbol=symbol,
                    price=round(price, 4),
                    bid=bid,
                    ask=ask,
                    spread=spread,
                    volume=volume,
                )
            )
        return quotes

    def seed_history(self, store: HistoryStore, seconds: int = 61) -> None:
        """Backfill history so indicators are ready on first eval cycle."""
        now = datetime.now(timezone.utc)
        for symbol in self.symbols:
            price = self._prices[symbol]
            history = store.get(symbol)
            for i in range(seconds, 0, -1):
                ts = now - timedelta(seconds=i)
                delta = self._rng.uniform(-0.0003, 0.0003)
                price = max(0.01, price * (1 + delta))
                volume = self._rng.randint(500_000, 2_000_000)
                history.record_point(ts, round(price, 4), volume)
            self._prices[symbol] = price
