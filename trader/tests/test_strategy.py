from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from models.types import JevPrediction, MarketState, Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager
from strategy.config import (
    StrategyConfig,
    breakout_dashboard_override,
    entry_rsi_spread_dashboard_overrides,
    rotation_dashboard_override,
    strategy_config_with_risk_overrides,
)
from strategy.confirmation import ConfirmationTracker
from strategy.filters import check_correlation_cap, check_entry_filters
from strategy.signals import (
    is_sell_exit_eligible,
    is_trade_eligible,
    signal_tier,
    trade_skip_reason_from_tier,
)


def _state(**overrides: object) -> MarketState:
    base = dict(
        symbol="NVDA",
        price=100.0,
        change_5m=0.2,
        change_15m=0.3,
        volume_ratio=1.2,
        rsi=55.0,
        ema_9=99.5,
        ema_20=98.0,
        bid=99.98,
        ask=100.02,
        spread=0.04,
        spy_change_5m=0.1,
    )
    base.update(overrides)
    return MarketState(**base)  # type: ignore[arg-type]


def _prediction(**overrides: object) -> JevPrediction:
    base = dict(
        symbol="NVDA",
        buy=0.86,
        hold=0.10,
        sell=0.04,
        timestamp=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return JevPrediction(**base)  # type: ignore[arg-type]


class TestSignals(unittest.TestCase):
    def test_eligible_requires_margin(self) -> None:
        tier = signal_tier(_prediction(buy=0.86, hold=0.80, sell=0.34), 0.75, 0.85, 0.15)
        self.assertIn("IGNORE (margin)", tier)
        self.assertFalse(is_trade_eligible(tier))

    def test_eligible_with_margin(self) -> None:
        tier = signal_tier(_prediction(), 0.75, 0.85, 0.15)
        self.assertIn("ELIGIBLE", tier)
        self.assertTrue(is_trade_eligible(tier))

    def test_skip_reason_from_tier(self) -> None:
        record = signal_tier(_prediction(buy=0.76, hold=0.20, sell=0.04), 0.75, 0.85, 0.15)
        self.assertEqual(trade_skip_reason_from_tier(record), "below_trade_threshold")
        margin = signal_tier(_prediction(buy=0.86, hold=0.80, sell=0.34), 0.75, 0.85, 0.15)
        self.assertEqual(trade_skip_reason_from_tier(margin), "buy_hold_margin")

    def test_sell_exit(self) -> None:
        prediction = _prediction(buy=0.10, hold=0.10, sell=0.80)
        self.assertTrue(is_sell_exit_eligible(prediction, 0.75))


class TestFilters(unittest.TestCase):
    def test_rejects_overbought_rsi(self) -> None:
        result = check_entry_filters(_state(rsi=75.0), StrategyConfig())
        self.assertFalse(result.passed)
        self.assertIn("rsi_overbought", result.reason)

    def test_rejects_price_below_ema20(self) -> None:
        result = check_entry_filters(_state(price=97.0, ema_20=98.0), StrategyConfig())
        self.assertFalse(result.passed)
        self.assertIn("price_below_ema20", result.reason)

    def test_rejects_price_below_ema9(self) -> None:
        config = StrategyConfig(entry_ema_gate="ema_9")
        result = check_entry_filters(
            _state(price=97.0, ema_9=98.0, ema_20=96.0),
            config,
        )
        self.assertFalse(result.passed)
        self.assertIn("price_below_ema9", result.reason)

    def test_rejects_ema_warming_up(self) -> None:
        result = check_entry_filters(_state(ema_20=None), StrategyConfig())
        self.assertFalse(result.passed)
        self.assertEqual(result.reason, "ema_warming_up")

    def test_allows_missing_ema_when_requirement_off(self) -> None:
        config = StrategyConfig(entry_ema_gate="off", min_volume_ratio=0.0)
        result = check_entry_filters(_state(ema_20=None), config)
        self.assertTrue(result.passed)

    def test_rejects_low_volume_when_enabled(self) -> None:
        config = StrategyConfig(min_volume_ratio=0.5)
        result = check_entry_filters(_state(volume_ratio=0.3), config)
        self.assertFalse(result.passed)
        self.assertIn("volume_too_low", result.reason)

    def test_volume_filter_on_by_default(self) -> None:
        result = check_entry_filters(_state(volume_ratio=0.1), StrategyConfig())
        self.assertFalse(result.passed)
        self.assertIn("volume_too_low", result.reason)

    def test_volume_filter_off_when_zero(self) -> None:
        result = check_entry_filters(
            _state(volume_ratio=0.1),
            StrategyConfig(min_volume_ratio=0.0),
        )
        self.assertTrue(result.passed)

    def test_min_share_price_off_when_zero(self) -> None:
        result = check_entry_filters(
            _state(price=1.69, ema_20=1.50, spread=0.0),
            StrategyConfig(min_share_price=0.0, max_spread_pct=1.0),
        )
        self.assertTrue(result.passed)

    def test_rejects_price_below_min_share_price(self) -> None:
        config = StrategyConfig(min_share_price=20.0, entry_ema_gate="off")
        result = check_entry_filters(_state(price=1.69), config)
        self.assertFalse(result.passed)
        self.assertIn("price_too_low", result.reason)

    def test_skips_benchmark_headwind_when_no_benchmark_data(self) -> None:
        result = check_entry_filters(
            _state(spy_change_5m=None, benchmark_change_5m=None),
            StrategyConfig(entry_ema_gate="off"),
        )
        self.assertTrue(result.passed)

    def test_rejects_benchmark_headwind_when_change_too_low(self) -> None:
        result = check_entry_filters(
            _state(benchmark_change_5m=-0.5, spy_change_5m=-0.5),
            StrategyConfig(entry_ema_gate="off"),
        )
        self.assertFalse(result.passed)
        self.assertIn("benchmark_headwind", result.reason)

    def test_correlation_cap(self) -> None:
        trades = [
            TradeRecord(
                id="1",
                symbol="BABA",
                side="buy",
                entry_time=datetime.now(timezone.utc),
                entry_price=100.0,
                quantity=1.0,
                position_value=100.0,
                stop_loss=99.0,
                take_profit=101.0,
                status="open",
                paper_or_live="paper",
            ),
            TradeRecord(
                id="2",
                symbol="PDD",
                side="buy",
                entry_time=datetime.now(timezone.utc),
                entry_price=100.0,
                quantity=1.0,
                position_value=100.0,
                stop_loss=99.0,
                take_profit=101.0,
                status="open",
                paper_or_live="paper",
            ),
        ]
        result = check_correlation_cap(trades, "BIDU", StrategyConfig())
        self.assertFalse(result.passed)
        self.assertIn("correlation_cap", result.reason)

        other = check_correlation_cap(trades, "VALE", StrategyConfig())
        self.assertTrue(other.passed)


class TestConfirmation(unittest.TestCase):
    def test_requires_two_cycles(self) -> None:
        tracker = ConfirmationTracker(2, required_seconds=0)
        self.assertFalse(tracker.record("NVDA", True))
        self.assertTrue(tracker.record("NVDA", True))
        tracker.reset("NVDA")
        self.assertEqual(tracker.progress("NVDA"), (0, 2))

    def test_reconfigure_updates_requirements(self) -> None:
        tracker = ConfirmationTracker(2, required_seconds=0)
        tracker.reconfigure(1, 0)
        self.assertEqual(tracker.progress("NVDA"), (0, 1))
        self.assertTrue(tracker.record("NVDA", True))
        tracker.reconfigure(1, 15.0)
        self.assertEqual(tracker.required_seconds, 15.0)

    def test_reconfigure_preserves_in_progress_state(self) -> None:
        tracker = ConfirmationTracker(2, required_seconds=60.0)
        self.assertFalse(tracker.record("NVDA", True))
        self.assertEqual(tracker.progress("NVDA"), (1, 2))
        started = tracker._first_eligible_mono["NVDA"]
        tracker.reconfigure(2, 15.0)
        self.assertEqual(tracker.progress("NVDA"), (1, 2))
        self.assertEqual(tracker._first_eligible_mono.get("NVDA"), started)

    def test_reconfigure_can_allow_immediate_entry_when_cycles_tighten(self) -> None:
        tracker = ConfirmationTracker(2, required_seconds=0)
        self.assertFalse(tracker.record("NVDA", True))
        tracker.reconfigure(1, 0)
        self.assertTrue(tracker.record("NVDA", True))


class TestMaxEntriesPerSymbol(unittest.TestCase):
    def test_blocks_after_daily_cap(self) -> None:
        settings = RiskSettings(
            minimum_jev_confidence=0.85,
            signal_record_threshold=0.75,
            risk_per_trade=100.0,
            max_position_size=10_000.0,
            max_daily_loss=500.0,
            max_open_positions=5,
            stop_loss_percentage=0.01,
            take_profit_percentage=0.015,
            max_hold_minutes=0.0,
            account_capital=10_000.0,
            risk_sync_equity=None,
            watchlist=["NVDA"],
            max_entries_per_symbol_per_day=2,
        )
        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )
        manager.hydrate_symbol_entry_counts({"NVDA": 2})
        decision = manager.evaluate_entry(
            _state(),
            _prediction(),
            True,
            {},
        )
        self.assertFalse(decision.approved)
        self.assertIn("max_entries_per_symbol", decision.reason or "")

    def test_register_and_remove_trade_adjusts_daily_entry_count(self) -> None:
        settings = RiskSettings(
            minimum_jev_confidence=0.85,
            signal_record_threshold=0.75,
            risk_per_trade=100.0,
            max_position_size=10_000.0,
            max_daily_loss=500.0,
            max_open_positions=5,
            stop_loss_percentage=0.01,
            take_profit_percentage=0.015,
            max_hold_minutes=0.0,
            account_capital=10_000.0,
            risk_sync_equity=None,
            watchlist=["NVDA"],
            max_entries_per_symbol_per_day=3,
        )
        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )
        trade = TradeRecord(
            id="t1",
            symbol="NVDA",
            side="buy",
            entry_time=datetime.now(timezone.utc),
            entry_price=100.0,
            quantity=1.0,
            position_value=100.0,
            stop_loss=99.0,
            take_profit=101.0,
            status="open",
            paper_or_live="paper",
        )
        manager.register_open_trade(trade)
        self.assertEqual(manager._entries_today["NVDA"], 1)
        manager.remove_open_trade("t1")
        self.assertEqual(manager._entries_today["NVDA"], 0)


class TestStrategyConfigOverrides(unittest.TestCase):
    def test_confirmation_from_dashboard(self) -> None:
        merged = strategy_config_with_risk_overrides(
            StrategyConfig(),
            min_volume_ratio=0.5,
            confirmation_cycles=1,
            confirmation_seconds=15.0,
        )
        self.assertEqual(merged.confirmation_cycles, 1)
        self.assertEqual(merged.confirmation_seconds, 15.0)
        self.assertEqual(merged.rotation_min_session_change_pct, 0.0)

    def test_rotation_session_from_dashboard(self) -> None:
        merged = strategy_config_with_risk_overrides(
            StrategyConfig(rotation_min_session_change_pct=0.0),
            min_volume_ratio=0.0,
            rotation_min_session_change_pct=None,
        )
        self.assertIsNone(merged.rotation_min_session_change_pct)
        merged_on = strategy_config_with_risk_overrides(
            StrategyConfig(rotation_min_session_change_pct=None),
            min_volume_ratio=0.0,
            rotation_min_session_change_pct=0.0,
        )
        self.assertEqual(merged_on.rotation_min_session_change_pct, 0.0)

    def test_rotation_override_skipped_when_not_from_settings(self) -> None:
        merged = strategy_config_with_risk_overrides(
            StrategyConfig(rotation_min_session_change_pct=0.0),
            min_volume_ratio=0.0,
            **rotation_dashboard_override(from_settings=False, value=None),
        )
        self.assertEqual(merged.rotation_min_session_change_pct, 0.0)


class TestTimeExit(unittest.TestCase):
    def test_simulated_time_exit(self) -> None:
        manager = RiskManager(
            settings=RiskSettings(
                minimum_jev_confidence=0.85,
                signal_record_threshold=0.75,
                risk_per_trade=100.0,
                max_position_size=10_000.0,
                max_daily_loss=500.0,
                max_open_positions=2,
                stop_loss_percentage=0.01,
                take_profit_percentage=0.015,
                max_hold_minutes=15.0,
                account_capital=10_000.0,
                risk_sync_equity=None,
                watchlist=["NVDA"],
            ),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )
        manager.open_trades = [
            TradeRecord(
                id="t1",
                symbol="NVDA",
                side="buy",
                entry_time=datetime.now(timezone.utc) - timedelta(minutes=20),
                entry_price=100.0,
                quantity=10.0,
                position_value=1000.0,
                stop_loss=99.0,
                take_profit=101.5,
                status="open",
                paper_or_live="paper",
                execution_mode="simulated",
            )
        ]
        quotes = {"NVDA": Quote(symbol="NVDA", price=100.5, bid=None, ask=None, spread=None)}

        closed = manager.check_exits(quotes, max_hold_minutes=15.0)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "time_exit")


class EntryRsiSpreadDashboardOverridesTest(unittest.TestCase):
    def test_applies_when_loaded_from_settings(self) -> None:
        base = StrategyConfig(max_rsi=70.0, max_spread_pct=0.0015)
        merged = strategy_config_with_risk_overrides(
            base,
            min_volume_ratio=0.5,
            **entry_rsi_spread_dashboard_overrides(
                max_rsi_from_settings=True,
                max_rsi=65.0,
                max_spread_pct_from_settings=True,
                max_spread_pct=0.002,
            ),
        )
        self.assertEqual(merged.max_rsi, 65.0)
        self.assertEqual(merged.max_spread_pct, 0.002)

    def test_skips_when_columns_not_loaded(self) -> None:
        base = StrategyConfig(max_rsi=70.0, max_spread_pct=0.0015)
        merged = strategy_config_with_risk_overrides(
            base,
            min_volume_ratio=0.5,
            **entry_rsi_spread_dashboard_overrides(
                max_rsi_from_settings=False,
                max_rsi=65.0,
                max_spread_pct_from_settings=False,
                max_spread_pct=0.002,
            ),
        )
        self.assertEqual(merged.max_rsi, 70.0)
        self.assertEqual(merged.max_spread_pct, 0.0015)


class BreakoutDashboardOverridesTest(unittest.TestCase):
    def test_applies_when_loaded_from_settings(self) -> None:
        base = StrategyConfig(breakout_max_rsi=82.0, breakout_enabled=True)
        from dataclasses import replace

        merged = replace(
            strategy_config_with_risk_overrides(base, min_volume_ratio=0.5),
            **breakout_dashboard_override(
                from_settings=True,
                enabled=False,
                lookback_minutes=12,
                min_volume_ratio=2.0,
                min_change_5m_pct=0.2,
                max_promotions_per_cycle=1,
                window_minutes=15.0,
                max_rsi=85.0,
            ),
        )
        self.assertFalse(merged.breakout_enabled)
        self.assertEqual(merged.breakout_max_rsi, 85.0)
        self.assertEqual(merged.breakout_lookback_minutes, 12)

    def test_skips_when_not_loaded(self) -> None:
        base = StrategyConfig(breakout_max_rsi=82.0)
        from dataclasses import replace

        merged = replace(
            strategy_config_with_risk_overrides(base, min_volume_ratio=0.5),
            **breakout_dashboard_override(
                from_settings=False,
                enabled=False,
                lookback_minutes=12,
                min_volume_ratio=2.0,
                min_change_5m_pct=0.2,
                max_promotions_per_cycle=1,
                window_minutes=15.0,
                max_rsi=85.0,
            ),
        )
        self.assertEqual(merged.breakout_max_rsi, 82.0)


if __name__ == "__main__":
    unittest.main()
