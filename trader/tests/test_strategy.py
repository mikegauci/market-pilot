from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from models.types import JevPrediction, MarketState, Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager
from strategy.config import StrategyConfig
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

    def test_rejects_low_volume_when_enabled(self) -> None:
        config = StrategyConfig(min_volume_ratio=0.5)
        result = check_entry_filters(_state(volume_ratio=0.3), config)
        self.assertFalse(result.passed)
        self.assertIn("volume_too_low", result.reason)

    def test_volume_filter_off_by_default(self) -> None:
        result = check_entry_filters(_state(volume_ratio=0.1), StrategyConfig())
        self.assertTrue(result.passed)

    def test_correlation_cap(self) -> None:
        trades = [
            TradeRecord(
                id="1",
                symbol="META",
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
                symbol="GOOGL",
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
        result = check_correlation_cap(trades, "NVDA", StrategyConfig())
        self.assertFalse(result.passed)


class TestConfirmation(unittest.TestCase):
    def test_requires_two_cycles(self) -> None:
        tracker = ConfirmationTracker(2)
        self.assertFalse(tracker.record("NVDA", True))
        self.assertTrue(tracker.record("NVDA", True))
        tracker.reset("NVDA")
        self.assertEqual(tracker.progress("NVDA"), (0, 2))


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
            )
        ]
        quotes = {"NVDA": Quote(symbol="NVDA", price=100.5, bid=None, ask=None, spread=None)}

        closed = manager.check_exits(quotes, max_hold_minutes=15.0)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "time_exit")


if __name__ == "__main__":
    unittest.main()
