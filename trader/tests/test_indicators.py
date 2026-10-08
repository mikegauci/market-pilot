from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBarAggregator
from market.bars import Bar
from market.indicators import _ema, _rsi, build_market_state, compute_intraday_from_bars
from models.types import Quote


class IndicatorTests(unittest.TestCase):
    def test_ema_on_known_series(self) -> None:
        prices = [float(i) for i in range(1, 21)]
        ema = _ema(prices, 20)
        self.assertIsNotNone(ema)
        self.assertAlmostEqual(ema, 10.5, places=1)

    def test_rsi_requires_enough_bars(self) -> None:
        prices = [100.0 + (i % 3) for i in range(20)]
        self.assertIsNotNone(_rsi(prices, 14))

    def test_compute_intraday_from_bars(self) -> None:
        agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(20):
            agg.record_point(
                base + timedelta(minutes=index),
                100.0 + (index % 5) - 2 + index * 0.01,
                1000 + index,
            )
        intraday = compute_intraday_from_bars(agg, live_price=119.0)
        self.assertIsNotNone(intraday.rsi)
        self.assertIsNotNone(intraday.ema_9)
        self.assertIsNotNone(intraday.ema_20)

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

    def test_build_market_state_without_benchmark(self) -> None:
        symbol_agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(16):
            symbol_agg.record_point(
                base + timedelta(minutes=index),
                100.0 + index,
                1000,
            )
        quote = Quote(
            symbol="NVDA", price=110.0, bid=109.9, ask=110.1, spread=0.2, volume=1000
        )
        state = build_market_state(
            quote,
            symbol_agg,
            None,
            warmup_min_1m_bars=15,
        )
        self.assertIsNotNone(state)
        assert state is not None
        self.assertIsNone(state.benchmark_change_5m)
        self.assertIsNone(state.spy_change_5m)

    def test_build_market_state_uses_cached_five_min_without_live_tape(self) -> None:
        base = datetime(2026, 1, 10, 14, 0, tzinfo=timezone.utc)
        cached = [
            Bar(
                symbol="AAPL",
                bar_size="5 mins",
                ts=base + timedelta(minutes=5 * index),
                open=100.0 + index,
                high=101.0 + index,
                low=99.0 + index,
                close=100.5 + index,
                volume=10_000,
            )
            for index in range(16)
        ]
        symbol_agg = MinuteBarAggregator()
        benchmark_agg = MinuteBarAggregator()
        quote = Quote(symbol="AAPL", price=110.0, bid=109.9, ask=110.1, spread=0.2, volume=1000)
        state = build_market_state(
            quote,
            symbol_agg,
            benchmark_agg,
            warmup_min_1m_bars=15,
            allow_five_min_fallback=True,
            symbol_intraday_bars=cached,
            benchmark_intraday_bars=cached,
        )
        self.assertIsNotNone(state)
        assert state is not None
        self.assertEqual(state.symbol, "AAPL")

    def test_benchmark_change_prefers_live_minute_bars_over_cached_five_min(self) -> None:
        prior_session = datetime(2026, 1, 9, 19, 0, tzinfo=timezone.utc)
        stale_benchmark = [
            Bar(
                symbol="QQQ",
                bar_size="5 mins",
                ts=prior_session + timedelta(minutes=5 * index),
                open=500.0,
                high=500.0,
                low=500.0,
                close=500.0 + index,
                volume=10_000,
            )
            for index in range(12)
        ]
        symbol_agg = MinuteBarAggregator()
        benchmark_agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(16):
            ts = base + timedelta(minutes=index)
            symbol_agg.record_point(ts, 100.0 + index, 1000)
            benchmark_agg.record_point(ts, 600.0 - index, 1000)

        quote = Quote(symbol="ADI", price=116.0, bid=115.9, ask=116.1, spread=0.2, volume=1000)
        state = build_market_state(
            quote,
            symbol_agg,
            benchmark_agg,
            warmup_min_1m_bars=15,
            benchmark_intraday_bars=stale_benchmark,
        )
        self.assertIsNotNone(state)
        assert state is not None
        self.assertIsNotNone(state.benchmark_change_5m)
        self.assertLess(state.benchmark_change_5m, 0)
        self.assertEqual(state.spy_change_5m, state.benchmark_change_5m)

    def test_benchmark_change_falls_back_to_cached_five_min_before_live_tape(self) -> None:
        base = datetime(2026, 1, 10, 14, 0, tzinfo=timezone.utc)
        cached = [
            Bar(
                symbol="QQQ",
                bar_size="5 mins",
                ts=base + timedelta(minutes=5 * index),
                open=500.0,
                high=500.0,
                low=500.0,
                close=500.0 + index,
                volume=10_000,
            )
            for index in range(16)
        ]
        symbol_agg = MinuteBarAggregator()
        for index in range(16):
            symbol_agg.record_point(base + timedelta(minutes=index), 100.0 + index, 1000)
        benchmark_agg = MinuteBarAggregator()
        quote = Quote(symbol="ADI", price=116.0, bid=115.9, ask=116.1, spread=0.2, volume=1000)
        state = build_market_state(
            quote,
            symbol_agg,
            benchmark_agg,
            warmup_min_1m_bars=15,
            benchmark_intraday_bars=cached,
        )
        self.assertIsNotNone(state)
        assert state is not None
        self.assertGreater(state.benchmark_change_5m, 0)


if __name__ == "__main__":
    unittest.main()
