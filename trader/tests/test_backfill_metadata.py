from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from broker.ibkr import IBKRClient
from market.bars import (
    BAR_SIZE_DAILY,
    BAR_SIZE_INTRADAY,
    OPEN_POSITION_INTRADAY_FRESHNESS,
    Bar,
    BarStore,
)


class FakeIBKR(IBKRClient):
    def __init__(
        self,
        bars_by_call: list[list[Bar]],
        *,
        unqualified: set[str] | None = None,
    ) -> None:
        super().__init__("127.0.0.1", 4002, 99)
        self._bars_by_call = list(bars_by_call)
        self._unqualified = {symbol.upper() for symbol in (unqualified or set())}
        self._connected = True

    def is_connected(self) -> bool:
        return self._connected

    def can_trade_symbol(self, symbol: str) -> bool:
        return symbol.upper() not in self._unqualified

    def fetch_historical_bars(self, symbol, duration="1 W", bar_size=BAR_SIZE_DAILY, use_rth=True):
        if self._bars_by_call:
            return self._bars_by_call.pop(0)
        return []


class InMemoryBarRepo:
    def __init__(self) -> None:
        self.bars: list[Bar] = []
        self.meta: dict[tuple[str, str], datetime] = {}

    def get_bars(self, symbol: str, bar_size: str) -> list[Bar]:
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


class BackfillMetadataTests(unittest.TestCase):
    def test_skips_metadata_when_ibkr_returns_no_bars(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        fetcher = FakeIBKR([[], []])

        result = store.backfill_symbol("NU", fetcher, force=True)

        self.assertEqual(result.status, "no_bars")
        self.assertNotIn(("NU", BAR_SIZE_DAILY), repo.meta)
        self.assertNotIn(("NU", BAR_SIZE_INTRADAY), repo.meta)

    def test_sets_metadata_when_bars_returned(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        now = datetime.now(timezone.utc)
        fetcher = FakeIBKR(
            [
                [Bar("NU", BAR_SIZE_DAILY, now, 10, 10, 10, 10, 100)],
                [Bar("NU", BAR_SIZE_INTRADAY, now, 10, 10, 10, 10, 100)],
            ]
        )

        result = store.backfill_symbol("NU", fetcher, force=True)

        self.assertEqual(result.status, "refreshed")
        self.assertIn(("NU", BAR_SIZE_DAILY), repo.meta)
        self.assertIn(("NU", BAR_SIZE_INTRADAY), repo.meta)

    def test_open_position_freshness_is_used_when_fetching(self) -> None:
        """An open-position symbol picked as stale (>5m) must not be re-skipped by the 30m default."""
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        now = datetime.now(timezone.utc)
        ten_min_ago = now - timedelta(minutes=10)
        repo.upsert_bars(
            [
                Bar("NU", BAR_SIZE_DAILY, now, 10, 10, 10, 10, 100),
                Bar("NU", BAR_SIZE_INTRADAY, ten_min_ago, 10, 10, 10, 10, 100),
            ]
        )
        repo.set_last_fetched_at("NU", BAR_SIZE_DAILY, now)
        repo.set_last_fetched_at("NU", BAR_SIZE_INTRADAY, ten_min_ago)

        self.assertTrue(
            store.needs_backfill("NU", intraday_max_age=OPEN_POSITION_INTRADAY_FRESHNESS)
        )
        fetcher = FakeIBKR([[Bar("NU", BAR_SIZE_INTRADAY, now, 10, 10, 10, 10, 100)]])
        summary = store.backfill_universe(["NU"], fetcher, pacing_sec=0, open_symbols=["NU"])

        self.assertEqual(summary.results[0].status, "refreshed")

    def test_unqualified_symbol_does_not_crash(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        fetcher = FakeIBKR([], unqualified={"PHOJY"})

        result = store.backfill_symbol("PHOJY", fetcher, force=True)

        self.assertEqual(result.status, "unqualified")
        self.assertNotIn(("PHOJY", BAR_SIZE_DAILY), repo.meta)

    def test_backfill_universe_continues_after_unqualified(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        now = datetime.now(timezone.utc)
        fetcher = FakeIBKR(
            [
                [Bar("NU", BAR_SIZE_DAILY, now, 10, 10, 10, 10, 100)],
                [Bar("NU", BAR_SIZE_INTRADAY, now, 10, 10, 10, 10, 100)],
            ],
            unqualified={"PHOJY"},
        )
        progress: list[str] = []

        summary = store.backfill_universe(
            ["PHOJY", "NU"],
            fetcher,
            force=True,
            on_progress=lambda result, index, total: progress.append(result.symbol),
        )

        self.assertEqual(summary.refreshed, 1)
        self.assertEqual(summary.unqualified_symbols, ["PHOJY"])
        self.assertEqual(progress, ["PHOJY", "NU"])


if __name__ == "__main__":
    unittest.main()
