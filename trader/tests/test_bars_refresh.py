from __future__ import annotations

import unittest
from datetime import datetime, timezone

from market.bars import BAR_SIZE_DAILY, BarStore


class InMemoryBarRepo:
    def __init__(self) -> None:
        self.bars: list = []
        self.meta: dict[tuple[str, str], datetime] = {}

    def get_bars(self, symbol: str, bar_size: str) -> list:
        return [
            bar
            for bar in self.bars
            if bar.symbol == symbol.upper() and bar.bar_size == bar_size
        ]

    def upsert_bars(self, bars) -> None:
        self.bars.extend(bars)

    def get_last_fetched_at(self, symbol: str, bar_size: str):
        return self.meta.get((symbol.upper(), bar_size))

    def set_last_fetched_at(self, symbol: str, bar_size: str, fetched_at: datetime) -> None:
        self.meta[(symbol.upper(), bar_size)] = fetched_at


class BarRefreshTests(unittest.TestCase):
    def test_needs_daily_refresh_when_no_metadata(self) -> None:
        store = BarStore(InMemoryBarRepo())
        self.assertTrue(store.needs_daily_refresh("NU"))

    def test_needs_daily_refresh_false_after_same_day_fetch(self) -> None:
        repo = InMemoryBarRepo()
        now = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
        repo.meta[("NU", BAR_SIZE_DAILY)] = now
        store = BarStore(repo)
        self.assertFalse(store.needs_daily_refresh("NU", now=now))


if __name__ == "__main__":
    unittest.main()
