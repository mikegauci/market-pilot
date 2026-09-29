from __future__ import annotations

import unittest
from datetime import datetime, timezone
from broker.ibkr import IBKRClient
from market.bars import BAR_SIZE_DAILY, BAR_SIZE_INTRADAY, Bar, BarStore


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
