from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from models.types import Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager
def _risk_settings() -> RiskSettings:
    return RiskSettings(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=10_000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10_000.0,
        risk_sync_equity=None,
        watchlist=["META", "NVDA"],
        min_hold_minutes=0.0,
    )


def _trade(**overrides: object) -> TradeRecord:
    base = dict(
        id="test-trade",
        symbol="META",
        side="buy",
        entry_time=datetime(2026, 9, 28, 15, 40, tzinfo=timezone.utc),
        entry_price=746.73,
        quantity=13.0,
        position_value=746.73 * 13.0,
        stop_loss=739.26,
        take_profit=757.93,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class TestCheckExits(unittest.TestCase):
    def setUp(self) -> None:
        self.manager = RiskManager(
            settings=_risk_settings(),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )

    def test_simulated_trade_closes_on_stop_loss(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {"META": Quote(symbol="META", price=735.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_exits(quotes)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].exit_price, 739.26)
        self.assertEqual(closed[0].reason, "stop_loss")
        self.assertEqual(self.manager.open_trades, [])

    def test_ibkr_trade_with_brackets_skips_simulated_exit(self) -> None:
        self.manager.open_trades = [
            _trade(
                execution_mode="ibkr",
                ibkr_parent_order_id=1,
                ibkr_sl_order_id=2,
                ibkr_tp_order_id=3,
            )
        ]
        quotes = {"META": Quote(symbol="META", price=735.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_exits(quotes)

        self.assertEqual(closed, [])
        self.assertEqual(len(self.manager.open_trades), 1)

    def test_ibkr_orphan_without_brackets_skips_simulated_exit(self) -> None:
        self.manager.open_trades = [
            _trade(
                execution_mode="ibkr",
                ibkr_parent_order_id=None,
                ibkr_sl_order_id=None,
                ibkr_tp_order_id=None,
            )
        ]
        quotes = {"META": Quote(symbol="META", price=735.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_exits(quotes)

        self.assertEqual(closed, [])
        self.assertEqual(len(self.manager.open_trades), 1)

    def test_jev_sell_exit_closes_profitable_trade(self) -> None:
        self.manager.open_trades = [_trade()]
        # At/above take profit so soft-exit is allowed (bracket TP zone).
        quotes = {"META": Quote(symbol="META", price=758.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_jev_exit("META", quotes)

        self.assertIsNotNone(closed)
        assert closed is not None
        self.assertEqual(closed.reason, "jev_sell")
        self.assertEqual(self.manager.open_trades, [])

    def test_jev_sell_exit_skips_losing_trade(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {"META": Quote(symbol="META", price=740.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_jev_exit("META", quotes)

        self.assertIsNone(closed)
        self.assertEqual(len(self.manager.open_trades), 1)
        self.assertFalse(
            self.manager.can_jev_sell_exit("META", quotes),
        )

    def test_jev_sell_exit_allowed_at_breakeven(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {"META": Quote(symbol="META", price=746.73, bid=None, ask=None, spread=None)}

        self.assertTrue(self.manager.can_jev_sell_exit("META", quotes))

    def test_jev_sell_exit_blocked_when_underwater(self) -> None:
        settings = _risk_settings()
        settings.min_hold_minutes = 0.0
        self.manager.update_settings(settings)

        self.manager.open_trades = [_trade(entry_price=100.0)]
        quotes = {"META": Quote(symbol="META", price=99.0, bid=None, ask=None, spread=None)}

        self.assertFalse(self.manager.can_jev_sell_exit("META", quotes))

    def test_jev_sell_exit_blocked_during_min_hold(self) -> None:
        settings = _risk_settings()
        settings.min_hold_minutes = 15.0
        self.manager.update_settings(settings)

        entry_time = datetime.now(timezone.utc) - timedelta(minutes=5)
        self.manager.open_trades = [_trade(entry_time=entry_time)]
        quotes = {"META": Quote(symbol="META", price=760.0, bid=None, ask=None, spread=None)}

        self.assertFalse(self.manager.can_jev_sell_exit("META", quotes))
        self.assertIsNone(self.manager.check_jev_exit("META", quotes))

    def test_jev_sell_exit_allowed_after_min_hold(self) -> None:
        settings = _risk_settings()
        settings.min_hold_minutes = 15.0
        self.manager.update_settings(settings)

        entry_time = datetime.now(timezone.utc) - timedelta(minutes=20)
        self.manager.open_trades = [_trade(entry_time=entry_time)]
        # At/above take profit so below-TP soft-exit gate does not apply.
        quotes = {"META": Quote(symbol="META", price=758.0, bid=None, ask=None, spread=None)}

        self.assertTrue(self.manager.can_jev_sell_exit("META", quotes))

    def test_jev_sell_exit_blocked_between_entry_and_take_profit(self) -> None:
        settings = _risk_settings()
        settings.min_hold_minutes = 0.0
        self.manager.update_settings(settings)

        self.manager.open_trades = [_trade()]
        # Above entry (746.73) but below TP (757.93).
        quotes = {"META": Quote(symbol="META", price=752.0, bid=None, ask=None, spread=None)}

        self.assertFalse(self.manager.can_jev_sell_exit("META", quotes))

    def test_reentry_cooldown_blocks_immediate_reentry(self) -> None:
        from models.types import JevPrediction, MarketState

        settings = _risk_settings()
        settings.reentry_cooldown_minutes = 45.0
        self.manager.update_settings(settings)
        self.manager.note_symbol_exit("META", datetime.now(timezone.utc))

        state = MarketState(
            symbol="META",
            price=750.0,
            change_5m=0.1,
            change_15m=0.2,
            volume_ratio=1.0,
            rsi=50.0,
            ema_9=745.0,
            ema_20=740.0,
            bid=749.9,
            ask=750.1,
            spread=0.2,
            spy_change_5m=0.0,
        )
        prediction = JevPrediction(
            symbol="META",
            buy=0.9,
            hold=0.05,
            sell=0.05,
            timestamp=datetime.now(timezone.utc),
        )
        decision = self.manager.evaluate_entry(state, prediction, True, {})
        self.assertFalse(decision.approved)
        self.assertIn("reentry_cooldown", decision.reason or "")

    def test_entry_blocked_rejects_new_trade(self) -> None:
        from models.types import JevPrediction, MarketState

        settings = _risk_settings()
        settings.entry_blocked_symbols = ["META"]
        self.manager.update_settings(settings)

        state = MarketState(
            symbol="META",
            price=750.0,
            change_5m=0.1,
            change_15m=0.2,
            volume_ratio=1.0,
            rsi=50.0,
            ema_9=745.0,
            ema_20=740.0,
            bid=749.9,
            ask=750.1,
            spread=0.2,
            spy_change_5m=0.0,
        )
        prediction = JevPrediction(
            symbol="META",
            buy=0.9,
            hold=0.05,
            sell=0.05,
            timestamp=datetime.now(timezone.utc),
        )
        decision = self.manager.evaluate_entry(state, prediction, True, {})
        self.assertFalse(decision.approved)
        self.assertEqual(decision.reason, "entry_blocked")

    def test_eod_flatten_closes_simulated_loser(self) -> None:
        self.manager.open_trades = [_trade(entry_price=100.0, quantity=10.0)]
        quotes = {
            "META": Quote(symbol="META", price=98.0, bid=97.9, ask=98.1, spread=None),
        }

        closed = self.manager.force_close_all_simulated(quotes, reason="eod_flatten")

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "eod_flatten")
        self.assertEqual(closed[0].exit_price, 97.9)
        self.assertLess(closed[0].net_pnl, 0)
        self.assertEqual(self.manager.open_trades, [])


if __name__ == "__main__":
    unittest.main()
