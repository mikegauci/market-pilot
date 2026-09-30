from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBar, MinuteBarAggregator, MinuteBarStore
from market.bars import (
    BAR_SIZE_INTRADAY,
    OPEN_POSITION_INTRADAY_FRESHNESS,
    Bar,
    BarStore,
    live_five_min_bars_for_flush,
    rollup_minute_bars_to_five_min,
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
        for bar in bars:
            key = (bar.symbol.upper(), bar.bar_size, bar.ts)
            replaced = False
            for index, existing in enumerate(self.bars):
                existing_key = (existing.symbol.upper(), existing.bar_size, existing.ts)
                if existing_key == key:
                    self.bars[index] = bar
                    replaced = True
                    break
            if not replaced:
                self.bars.append(bar)

    def get_last_fetched_at(self, symbol: str, bar_size: str):
        return self.meta.get((symbol.upper(), bar_size))

    def set_last_fetched_at(self, symbol: str, bar_size: str, fetched_at: datetime) -> None:
        self.meta[(symbol.upper(), bar_size)] = fetched_at


class RollupAndFlushTests(unittest.TestCase):
    def test_rollup_minute_bars_to_five_min(self) -> None:
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        minutes = [
            MinuteBar(base + timedelta(minutes=0), 100.0, 101.0, 99.5, 100.5, 10),
            MinuteBar(base + timedelta(minutes=1), 100.5, 102.0, 100.0, 101.5, 20),
            MinuteBar(base + timedelta(minutes=2), 101.5, 103.0, 101.0, 102.0, 30),
            MinuteBar(base + timedelta(minutes=5), 102.0, 104.0, 101.5, 103.5, 40),
        ]

        rolled = rollup_minute_bars_to_five_min("AAPL", minutes)
        self.assertEqual(len(rolled), 2)
        self.assertEqual(rolled[0].ts, base)
        self.assertEqual(rolled[0].open, 100.0)
        self.assertEqual(rolled[0].high, 103.0)
        self.assertEqual(rolled[0].low, 99.5)
        self.assertEqual(rolled[0].close, 102.0)
        self.assertEqual(rolled[0].volume, 60)
        self.assertEqual(rolled[0].bar_size, BAR_SIZE_INTRADAY)
        self.assertEqual(rolled[1].ts, base + timedelta(minutes=5))
        self.assertEqual(rolled[1].close, 103.5)

    def test_flush_live_intraday_bars_upserts_completed_and_forming(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo)
        minute_bars = MinuteBarStore(["AAPL"])
        agg = minute_bars.get("AAPL")
        # Start on a 5m boundary so the first live bucket is fully safe.
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)

        for offset, price in enumerate([100.0, 101.0, 102.0, 103.0, 104.0, 105.0]):
            agg.record_point(base + timedelta(minutes=offset), price, 1000 + offset * 100)

        flushed = store.flush_live_intraday_bars(["AAPL"], minute_bars)
        self.assertEqual(flushed, 1)

        bars = [bar for bar in repo.bars if bar.symbol == "AAPL"]
        self.assertGreaterEqual(len(bars), 2)
        newest = max(bars, key=lambda item: item.ts)
        self.assertEqual(newest.close, 105.0)
        # Live flush must not pretend to be a full historical fetch.
        self.assertNotIn(("AAPL", BAR_SIZE_INTRADAY), repo.meta)

    def test_flush_skips_bootstrap_placeholders(self) -> None:
        repo = InMemoryBarRepo()
        historical_ts = datetime(2026, 1, 10, 14, 55, tzinfo=timezone.utc)
        historical = Bar(
            "AAPL",
            BAR_SIZE_INTRADAY,
            historical_ts,
            open=100.0,
            high=110.0,
            low=95.0,
            close=105.0,
            volume=5000,
        )
        repo.upsert_bars([historical])

        store = BarStore(repo)
        minute_bars = MinuteBarStore(["AAPL"])
        agg = minute_bars.get("AAPL")
        agg.bootstrap_from_five_min_bars([historical])

        # No live ticks yet — flush must be a no-op and preserve IBKR OHLC.
        self.assertEqual(store.flush_live_intraday_bars(["AAPL"], minute_bars), 0)
        preserved = repo.get_bars("AAPL", BAR_SIZE_INTRADAY)[0]
        self.assertEqual(preserved.open, 100.0)
        self.assertEqual(preserved.high, 110.0)
        self.assertEqual(preserved.low, 95.0)
        self.assertEqual(preserved.close, 105.0)

    def test_live_five_min_bars_skips_partial_first_bucket(self) -> None:
        agg = MinuteBarAggregator()
        # Live starts mid-bucket at :03 → first safe bucket is :05.
        live_start = datetime(2026, 1, 10, 15, 3, tzinfo=timezone.utc)
        for offset, price in enumerate([100.0, 101.0, 102.0, 103.0]):
            agg.record_point(live_start + timedelta(minutes=offset), price, 100)

        safe = live_five_min_bars_for_flush("AAPL", agg)
        self.assertTrue(all(bar.ts >= datetime(2026, 1, 10, 15, 5, tzinfo=timezone.utc) for bar in safe))
        self.assertFalse(
            any(bar.ts == datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc) for bar in safe)
        )

    def test_open_position_intraday_freshness_is_shorter(self) -> None:
        repo = InMemoryBarRepo()
        now = datetime(2026, 1, 10, 16, 0, tzinfo=timezone.utc)
        repo.meta[("AAPL", BAR_SIZE_INTRADAY)] = now - timedelta(minutes=10)
        # Daily must look fresh so only intraday age drives the result.
        repo.meta[("AAPL", "1 day")] = now
        store = BarStore(repo)

        self.assertFalse(store.needs_intraday_refresh("AAPL", now=now))
        self.assertTrue(
            store.needs_intraday_refresh(
                "AAPL",
                now=now,
                max_age=OPEN_POSITION_INTRADAY_FRESHNESS,
            )
        )


if __name__ == "__main__":
    unittest.main()
