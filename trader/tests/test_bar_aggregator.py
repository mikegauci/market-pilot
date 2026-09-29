from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBarAggregator, MinuteBarStore
from market.bars import BAR_SIZE_INTRADAY, Bar


class BarAggregatorTests(unittest.TestCase):
    def test_bootstrap_from_five_min_bars(self) -> None:
        now = datetime.now(timezone.utc)
        bars = [
            Bar("VALE", BAR_SIZE_INTRADAY, now - timedelta(minutes=10), 10, 10, 10, 10.0, 5000),
            Bar("VALE", BAR_SIZE_INTRADAY, now - timedelta(minutes=5), 10, 10, 10, 10.5, 6000),
        ]
        agg = MinuteBarAggregator()
        agg.bootstrap_from_five_min_bars(bars)
        self.assertEqual(agg.bar_count(), 10)
        self.assertEqual(agg.closes()[-1], 10.5)

    def test_cumulative_volume_uses_deltas(self) -> None:
        agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        agg.record_point(base, 100.0, 1_000_000)
        agg.record_point(base + timedelta(seconds=10), 100.1, 1_000_500)
        agg.record_point(base + timedelta(seconds=20), 100.2, 1_001_200)
        self.assertEqual(agg.volumes()[-1], 1200)

    def test_record_aggregates_into_minute_buckets(self) -> None:
        agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        agg.record_point(base + timedelta(seconds=10), 100.0, 100)
        agg.record_point(base + timedelta(seconds=40), 101.0, 200)
        agg.record_point(base + timedelta(minutes=1, seconds=5), 102.0, 150)

        self.assertEqual(agg.bar_count(), 2)
        closes = agg.closes()
        self.assertEqual(closes[0], 101.0)
        self.assertEqual(closes[1], 102.0)

    def test_change_pct_from_one_minute_bars(self) -> None:
        agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        prices = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0]
        for index, price in enumerate(prices):
            agg.record_point(base + timedelta(minutes=index), price, 1000)
        self.assertEqual(agg.change_pct(1), round((105.0 - 104.0) / 104.0 * 100, 4))
        self.assertEqual(agg.change_pct(5), round((105.0 - 100.0) / 100.0 * 100, 4))

    def test_minute_bar_store_ensure_symbol(self) -> None:
        store = MinuteBarStore(["AAPL"])
        store.get("MSFT").record_point(datetime.now(timezone.utc), 200.0, 100)
        self.assertEqual(store.get("MSFT").bar_count(), 1)


if __name__ == "__main__":
    unittest.main()
