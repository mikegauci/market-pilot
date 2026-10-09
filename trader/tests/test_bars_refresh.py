from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from market.bars import (
    BAR_SIZE_DAILY,
    BAR_SIZE_INTRADAY,
    MIN_INTRADAY_BARS,
    BackfillSymbolResult,
    Bar,
    BarStore,
)


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

    def get_latest_bar_ts(self, symbol: str, bar_size: str):
        matches = [
            bar.ts
            for bar in self.bars
            if bar.symbol == symbol.upper() and bar.bar_size == bar_size
        ]
        return max(matches) if matches else None

    def count_bars(self, symbol: str, bar_size: str) -> int:
        return sum(
            1
            for bar in self.bars
            if bar.symbol == symbol.upper() and bar.bar_size == bar_size
        )


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

    def test_symbols_needing_backfill_only_returns_stale(self) -> None:
        repo = InMemoryBarRepo()
        now = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
        repo.meta[("AMD", BAR_SIZE_DAILY)] = now
        repo.meta[("AMD", BAR_SIZE_INTRADAY)] = now
        store = BarStore(repo)
        self.assertEqual(store.symbols_needing_backfill(["AMD", "NVDA"], now=now), ["NVDA"])

    def test_backfill_universe_skips_pacing_for_fresh_symbols(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=1.0)

        def fake_backfill(symbol: str, fetcher: object, *, force: bool = False, intraday_max_age=None):
            if symbol == "AMD":
                return BackfillSymbolResult(symbol, "skipped_fresh")
            return BackfillSymbolResult(symbol, "refreshed")

        with patch.object(store, "backfill_symbol", side_effect=fake_backfill):
            with patch("market.bars.time.sleep") as sleep_mock:
                summary = store.backfill_universe(["AMD", "NVDA", "AAPL"], object())

        self.assertEqual(summary.refreshed, 2)
        sleep_mock.assert_called_once()

    def test_intraday_cache_fresh_skips_stale_metadata(self) -> None:
        repo = InMemoryBarRepo()
        now = datetime(2026, 10, 8, 19, 0, tzinfo=timezone.utc)
        repo.meta[("NVDA", BAR_SIZE_INTRADAY)] = now - timedelta(hours=8)
        for index in range(MIN_INTRADAY_BARS):
            repo.bars.append(
                Bar(
                    symbol="NVDA",
                    bar_size=BAR_SIZE_INTRADAY,
                    ts=now - timedelta(minutes=5 * (MIN_INTRADAY_BARS - index)),
                    open=100.0,
                    high=100.0,
                    low=100.0,
                    close=100.0,
                    volume=1000,
                )
            )
        store = BarStore(repo)
        with patch("market.bars.is_us_regular_session_open", return_value=True):
            self.assertFalse(store.needs_intraday_refresh("NVDA", now=now))


if __name__ == "__main__":
    unittest.main()
