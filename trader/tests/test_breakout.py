from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from market.bar_aggregator import MinuteBarAggregator, MinuteBarStore
from market.bars import Bar
from models.types import Quote, RiskSettings
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from watchlist.breakout import breakout_entry_config, detect_breakout
from watchlist.breakout_runtime import maybe_promote_breakouts

START = datetime(2026, 10, 8, 18, 0, tzinfo=timezone.utc)


def _feed(
    aggregator: MinuteBarAggregator,
    *,
    flat_minutes: int = 12,
    flat_price: float = 100.0,
    flat_volume: int = 1_000,
    last_price: float = 100.4,
    last_volume: int = 3_000,
) -> None:
    cumulative = 10_000
    aggregator.record_point(START, flat_price, cumulative)
    for minute in range(flat_minutes):
        ts = START + timedelta(minutes=minute)
        cumulative += flat_volume
        aggregator.record_point(ts + timedelta(seconds=30), flat_price + 0.05, cumulative)
        aggregator.record_point(ts + timedelta(seconds=59), flat_price, cumulative)
    cumulative += last_volume
    aggregator.record_point(
        START + timedelta(minutes=flat_minutes, seconds=20), last_price, cumulative
    )


def _risk(**overrides) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.74,
        signal_record_threshold=0.65,
        risk_per_trade=100.0,
        max_position_size=5_000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10_000.0,
        risk_sync_equity=None,
        watchlist=["AAA"],
        watchlist_rotation_enabled=True,
        watchlist_pool=["AAA", "BBB", "QCOM"],
        watchlist_active=["AAA", "BBB"],
        watchlist_active_size=2,
        watchlist_rotation_interval_minutes=15,
        watchlist_max_swaps_per_rotation=3,
    )
    base.update(overrides)
    return RiskSettings(**base)


class DetectBreakoutTests(unittest.TestCase):
    def test_fires_on_new_high_with_volume_spike(self) -> None:
        aggregator = MinuteBarAggregator()
        _feed(aggregator)
        signal = detect_breakout("qcom", aggregator, 100.4, StrategyConfig())
        self.assertIsNotNone(signal)
        assert signal is not None
        self.assertEqual(signal.symbol, "QCOM")
        self.assertAlmostEqual(signal.prior_high, 100.05)
        self.assertGreaterEqual(signal.volume_ratio, 1.5)
        self.assertGreaterEqual(signal.change_5m, 0.15)

    def test_no_signal_below_prior_high(self) -> None:
        aggregator = MinuteBarAggregator()
        _feed(aggregator, last_price=100.04)
        self.assertIsNone(detect_breakout("QCOM", aggregator, 100.04, StrategyConfig()))

    def test_no_signal_without_volume_spike(self) -> None:
        aggregator = MinuteBarAggregator()
        _feed(aggregator, last_volume=1_000)
        self.assertIsNone(detect_breakout("QCOM", aggregator, 100.4, StrategyConfig()))

    def test_no_signal_when_benchmark_moved_more(self) -> None:
        aggregator = MinuteBarAggregator()
        _feed(aggregator)
        self.assertIsNone(
            detect_breakout(
                "QCOM", aggregator, 100.4, StrategyConfig(), benchmark_change_5m=0.5
            )
        )

    def test_short_lookback_is_raised_to_minimum_and_still_fires(self) -> None:
        aggregator = MinuteBarAggregator()
        _feed(aggregator)
        signal = detect_breakout(
            "QCOM", aggregator, 100.4, StrategyConfig(breakout_lookback_minutes=2)
        )
        self.assertIsNotNone(signal)

    def test_seeded_history_alone_is_not_enough(self) -> None:
        aggregator = MinuteBarAggregator()
        aggregator.bootstrap_from_minute_bars(
            [
                Bar(
                    symbol="QCOM",
                    bar_size="1 min",
                    ts=START + timedelta(minutes=i),
                    open=100.0,
                    high=100.05,
                    low=99.95,
                    close=100.0,
                    volume=5_000,
                )
                for i in range(12)
            ]
        )
        aggregator.record_point(START + timedelta(minutes=12), 100.4, 50_000)
        self.assertIsNone(detect_breakout("QCOM", aggregator, 100.4, StrategyConfig()))


class BreakoutEntryConfigTests(unittest.TestCase):
    def test_rsi_cap_rises_only_inside_window(self) -> None:
        config = StrategyConfig(max_rsi=75.0, breakout_max_rsi=82.0)
        windows = {"QCOM": 200.0}
        self.assertEqual(breakout_entry_config(config, "qcom", windows, 100.0).max_rsi, 82.0)
        self.assertEqual(breakout_entry_config(config, "QCOM", windows, 300.0).max_rsi, 75.0)
        self.assertEqual(breakout_entry_config(config, "META", windows, 100.0).max_rsi, 75.0)


class PromoteBreakoutsTests(unittest.TestCase):
    def _run(
        self,
        risk: RiskSettings,
        *,
        open_symbols=(),
        runtime=None,
        strategy_config=None,
        entry_window_open=True,
    ):
        minute_bars = MinuteBarStore(["AAA", "BBB", "QCOM"])
        _feed(minute_bars.get("QCOM"))
        db = MagicMock()
        runtime = runtime or TraderRuntimeState()
        updated, added = maybe_promote_breakouts(
            db=db,
            risk_settings=risk,
            minute_bars=minute_bars,
            bar_store=None,
            quotes_by_symbol={
                symbol: Quote(symbol=symbol, price=price, bid=None, ask=None, spread=None)
                for symbol, price in (("QCOM", 100.4), ("AAA", 50.0), ("BBB", 60.0))
            },
            benchmark_minute_bars=None,
            confirmation_tracker=ConfirmationTracker(1),
            open_symbols=list(open_symbols),
            runtime=runtime,
            now_mono=1_000.0,
            market_open=True,
            strategy_config=strategy_config
            or StrategyConfig(rotation_min_session_change_pct=None),
            entry_window_open=entry_window_open,
        )
        return updated, added, db, runtime

    def test_swaps_breakout_in_and_opens_window(self) -> None:
        updated, added, db, runtime = self._run(_risk())
        self.assertEqual(added, ["QCOM"])
        self.assertIn("QCOM", updated.watchlist_active)
        self.assertEqual(len(updated.watchlist_active), 2)
        self.assertTrue(updated.watchlist_last_rotation_note.startswith("breakout added QCOM"))
        self.assertEqual(runtime.breakout_until_mono["QCOM"], 1_000.0 + 600.0)
        db.save_watchlist_rotation.assert_called_once()

    def test_open_positions_are_not_swapped_out(self) -> None:
        updated, added, _, _ = self._run(_risk(), open_symbols=["AAA", "BBB"])
        self.assertEqual(added, [])
        self.assertEqual(updated.watchlist_active, ["AAA", "BBB"])

    def test_cap_counts_names_still_inside_their_window(self) -> None:
        runtime = TraderRuntimeState()
        runtime.breakout_until_mono = {"AAA": 1_200.0, "BBB": 1_300.0}
        _, added, _, _ = self._run(_risk(), runtime=runtime)
        self.assertEqual(added, [])

        runtime = TraderRuntimeState()
        runtime.breakout_until_mono = {"AAA": 1_200.0, "BBB": 900.0}
        _, added, _, _ = self._run(_risk(watchlist_active_size=3), runtime=runtime)
        self.assertEqual(added, ["QCOM"])

    def test_session_floor_blocks_names_red_on_the_day(self) -> None:
        config = StrategyConfig(rotation_min_session_change_pct=0.0)
        with patch(
            "watchlist.breakout_runtime.session_change_pct_for_rotation",
            return_value=-0.4,
        ):
            _, added, _, _ = self._run(_risk(), strategy_config=config)
        self.assertEqual(added, [])
        with patch(
            "watchlist.breakout_runtime.session_change_pct_for_rotation",
            return_value=0.6,
        ):
            _, added, _, _ = self._run(_risk(), strategy_config=config)
        self.assertEqual(added, ["QCOM"])

    def test_no_promotion_after_entry_cutoff(self) -> None:
        _, added, db, _ = self._run(_risk(), entry_window_open=False)
        self.assertEqual(added, [])
        db.save_watchlist_rotation.assert_not_called()

    def test_disabled_is_noop(self) -> None:
        risk = _risk(watchlist_rotation_enabled=False)
        updated, added, db, _ = self._run(risk)
        self.assertIs(updated, risk)
        self.assertEqual(added, [])
        db.save_watchlist_rotation.assert_not_called()


if __name__ == "__main__":
    unittest.main()
