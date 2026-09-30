from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBar, MinuteBarAggregator
from market.indicators import _ema, _rsi, build_market_state, compute_intraday_from_bars
from market.live_1m_bars import forward_fill_zero_volume
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

    def test_rsi_flat_series_is_unknown_not_overbought(self) -> None:
        prices = [100.0] * 20
        self.assertIsNone(_rsi(prices, 14))

    def test_compute_intraday_from_bars(self) -> None:
        agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(25):
            agg.record_point(
                base + timedelta(minutes=index),
                100.0 + index,
                1_000_000 + index * 1000,
            )
        intraday = compute_intraday_from_bars(agg, live_price=124.0)
        self.assertIsNotNone(intraday.rsi)
        self.assertIsNotNone(intraday.ema_9)
        self.assertIsNotNone(intraday.ema_20)
        self.assertIsNotNone(intraday.change_5m)

    def test_compute_intraday_ignores_forward_fill_zeros(self) -> None:
        """Trailing flat fills must not force RSI=100 / change_5m=0 / null volume."""
        agg = MinuteBarAggregator()
        base = datetime(2026, 9, 30, 13, 30, tzinfo=timezone.utc)
        # Oscillating real bars so RSI is defined and not trivially 100.
        real: list[MinuteBar] = []
        for index in range(20):
            price = 100.0 + index * 0.05 + ((-1) ** index) * 0.2
            real.append(
                MinuteBar(
                    ts=base + timedelta(minutes=index),
                    open=price,
                    high=price,
                    low=price,
                    close=price,
                    volume=1000 + index * 10,
                )
            )
        filled = list(real)
        last = real[-1].close
        for index in range(20, 40):
            filled.append(
                MinuteBar(
                    ts=base + timedelta(minutes=index),
                    open=last,
                    high=last,
                    low=last,
                    close=last,
                    volume=0,
                )
            )
        agg.replace_completed_bars(filled)

        # Flat trail alone is unknown under the new RSI rule (not max-overbought).
        self.assertIsNone(_rsi([last] * 20))

        intraday = compute_intraday_from_bars(agg, live_price=last + 0.05)
        self.assertIsNotNone(intraday.rsi)
        self.assertNotEqual(intraday.rsi, 100.0)
        self.assertIsNotNone(intraday.change_5m)
        self.assertNotEqual(intraday.change_5m, 0.0)
        self.assertIsNotNone(intraday.volume_ratio)

    def test_build_market_state_warmup_gate(self) -> None:
        symbol_agg = MinuteBarAggregator()
        benchmark_agg = MinuteBarAggregator()
        base = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        for index in range(10):
            ts = base + timedelta(minutes=index)
            # Cumulative session volume so per-minute deltas are > 0.
            symbol_agg.record_point(ts, 100.0 + index, 1_000_000 + index * 1000)
            benchmark_agg.record_point(ts, 500.0, 5_000_000 + index * 1000)

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
            symbol_agg.record_point(ts, 100.0 + index, 1_000_000 + index * 1000)
            benchmark_agg.record_point(ts, 500.0, 5_000_000 + index * 1000)

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

    def test_build_market_state_rejects_fill_only_warmup(self) -> None:
        """Enough total bars but too few real-volume bars → no Jev state."""
        symbol_agg = MinuteBarAggregator()
        benchmark_agg = MinuteBarAggregator()
        base = datetime(2026, 9, 30, 13, 30, tzinfo=timezone.utc)
        bars = [
            MinuteBar(base, 10, 10, 10, 10, 100),
            MinuteBar(base + timedelta(minutes=1), 10.1, 10.1, 10.1, 10.1, 110),
        ]
        session_open = base
        session_close = base + timedelta(hours=6)
        now = base + timedelta(minutes=30)
        filled = forward_fill_zero_volume(
            bars, session_open=session_open, session_close=session_close, now=now
        )
        # Manually add trailing fills as the old bug did, to prove the gate.
        last = filled[-1].close
        for index in range(2, 20):
            filled.append(
                MinuteBar(
                    ts=base + timedelta(minutes=index),
                    open=last,
                    high=last,
                    low=last,
                    close=last,
                    volume=0,
                )
            )
        symbol_agg.replace_completed_bars(filled)
        for index in range(20):
            benchmark_agg.record_point(base + timedelta(minutes=index), 50.0, 1000)

        quote = Quote(symbol="PDD", price=10.1, bid=10.0, ask=10.2, spread=0.2)
        self.assertGreaterEqual(symbol_agg.bar_count(), 15)
        self.assertLess(symbol_agg.real_volume_bar_count(), 15)
        self.assertIsNone(
            build_market_state(
                quote,
                symbol_agg,
                benchmark_agg,
                warmup_min_1m_bars=15,
            )
        )


if __name__ == "__main__":
    unittest.main()
