from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBarAggregator
from market.indicators import _ema, _rsi, build_market_state, compute_intraday_from_bars
from models.types import Quote


class IndicatorTests(unittest.TestCase):
    def test_ema_on_known_series(self) -> None:
        prices = [float(i) for i in range(1, 21)]
        ema = _ema(prices, 20)
        self.assertIsNotNone(ema)
        self.assertAlmostEqual(ema, 10.5, places=1)

    def test_rsi_requires_enough_bars(self) -> None:
        prices = [100.0 + i for i in range(16)]
        self.assertIsNotNone(_rsi(prices, 14))

    def test_compute_intraday_from_bars(self) -> None:
        agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(20):
            agg.record_point(base + timedelta(minutes=index), 100.0 + index, 1000 + index)
        intraday = compute_intraday_from_bars(agg, live_price=119.0)
        self.assertIsNotNone(intraday.rsi)
        self.assertIsNotNone(intraday.ema_9)
        self.assertIsNotNone(intraday.ema_20)
        self.assertIsNotNone(intraday.change_5m)

    def test_build_market_state_warmup_gate(self) -> None:
        symbol_agg = MinuteBarAggregator()
        benchmark_agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(10):
            ts = base + timedelta(minutes=index)
            symbol_agg.record_point(ts, 100.0 + index, 1000)
            benchmark_agg.record_point(ts, 500.0, 1000)

        quote = Quote(symbol="VALE", price=110.0, bid=109.9, ask=110.1, spread=0.2, volume=1000)
        self.assertIsNone(
            build_market_state(
                quote,
                symbol_agg,
                benchmark_agg,
                warmup_min_1m_bars=15,
            )
        )

        for index in range(10, 16):
            ts = base + timedelta(minutes=index)
            symbol_agg.record_point(ts, 100.0 + index, 1000)
            benchmark_agg.record_point(ts, 500.0, 1000)

        state = build_market_state(
            quote,
            symbol_agg,
            benchmark_agg,
            warmup_min_1m_bars=15,
        )
        self.assertIsNotNone(state)
        assert state is not None
        self.assertEqual(state.symbol, "VALE")
        self.assertIsNotNone(state.rsi)
        self.assertIsNotNone(state.benchmark_change_5m)


if __name__ == "__main__":
    unittest.main()
