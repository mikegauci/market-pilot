from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from broker.execution import close_ibkr_signal_exits, collect_profit_take_trade_ids
from models.types import OrderFill, Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager
from strategy.exits import (
    is_profit_take_eligible,
    normalize_profit_take_fractions,
    take_profit_path_progress,
)


def _risk_settings(**overrides: object) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=10_000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.10,
        max_hold_minutes=0.0,
        account_capital=10_000.0,
        risk_sync_equity=None,
        watchlist=["META"],
        min_hold_minutes=0.0,
        profit_take_enabled=True,
        profit_take_min_fraction=0.70,
        profit_take_max_fraction=0.80,
    )
    base.update(overrides)
    return RiskSettings(**base)  # type: ignore[arg-type]


def _trade(**overrides: object) -> TradeRecord:
    base = dict(
        id="test-trade",
        symbol="META",
        side="buy",
        entry_time=datetime(2026, 9, 28, 15, 40, tzinfo=timezone.utc),
        entry_price=100.0,
        quantity=10.0,
        position_value=1000.0,
        stop_loss=95.0,
        take_profit=110.0,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class TestProfitTakeHelpers(unittest.TestCase):
    def test_path_progress_at_seventy_percent(self) -> None:
        trade = _trade()
        self.assertAlmostEqual(take_profit_path_progress(trade, 107.0), 0.70)

    def test_eligible_in_band(self) -> None:
        trade = _trade()
        self.assertTrue(
            is_profit_take_eligible(
                trade,
                107.0,
                enabled=True,
                min_fraction=0.70,
                max_fraction=0.80,
            )
        )
        self.assertFalse(
            is_profit_take_eligible(
                trade,
                106.9,
                enabled=True,
                min_fraction=0.70,
                max_fraction=0.80,
            )
        )
        self.assertFalse(
            is_profit_take_eligible(
                trade,
                107.0,
                enabled=False,
                min_fraction=0.70,
                max_fraction=0.80,
            )
        )

    def test_eligible_above_band_below_full_tp(self) -> None:
        trade = _trade()
        self.assertTrue(
            is_profit_take_eligible(
                trade,
                108.5,
                enabled=True,
                min_fraction=0.70,
                max_fraction=0.80,
            )
        )

    def test_normalize_invalid_fractions(self) -> None:
        min_f, max_f = normalize_profit_take_fractions(0.9, 0.5)
        self.assertEqual(min_f, 0.70)
        self.assertEqual(max_f, 0.80)


class TestProfitTakeSimExit(unittest.TestCase):
    def setUp(self) -> None:
        self.manager = RiskManager(
            settings=_risk_settings(),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )

    def test_closes_in_profit_take_zone(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(
                symbol="META", price=107.0, bid=106.95, ask=None, spread=None
            ),
        }

        closed = self.manager.check_exits(quotes)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "profit_take")
        self.assertEqual(closed[0].exit_price, 106.95)

    def test_no_exit_below_band(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(symbol="META", price=106.9, bid=None, ask=None, spread=None),
        }
        self.assertEqual(self.manager.check_exits(quotes), [])

    def test_stop_loss_before_profit_take(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(symbol="META", price=94.0, bid=None, ask=None, spread=None),
        }
        closed = self.manager.check_exits(quotes)
        self.assertEqual(closed[0].reason, "stop_loss")

    def test_disabled_skips_profit_take(self) -> None:
        self.manager.settings = _risk_settings(profit_take_enabled=False)
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(symbol="META", price=107.0, bid=None, ask=None, spread=None),
        }
        self.assertEqual(self.manager.check_exits(quotes), [])

    def test_full_take_profit_when_at_target(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(symbol="META", price=111.0, bid=None, ask=None, spread=None),
        }

        closed = self.manager.check_exits(quotes)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "take_profit")


class TestProfitTakeIbkrExit(unittest.TestCase):
    def test_collect_and_close_ibkr_in_zone(self) -> None:
        settings = _risk_settings()
        trade = _trade(
            id="ibkr-trade-1",
            execution_mode="ibkr",
            ibkr_parent_order_id=1,
            ibkr_sl_order_id=2,
            ibkr_tp_order_id=3,
        )
        quotes = {
            "META": Quote(symbol="META", price=107.0, bid=None, ask=None, spread=None),
        }
        trade_ids = collect_profit_take_trade_ids([trade], quotes, settings)
        self.assertEqual(trade_ids, {"ibkr-trade-1"})

        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
            open_trades=[trade],
        )
        ibkr = MagicMock()
        ibkr.close_long_position.return_value = OrderFill(
            price=107.0, quantity=10.0, commission=0.0
        )
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0

        closed = close_ibkr_signal_exits(
            ibkr,
            manager,
            db,
            profit_take_trade_ids=trade_ids,
            max_hold_minutes=100.0,
        )

        self.assertTrue(closed)
        self.assertEqual(db.close_trade.call_args.kwargs["exit_reason"], "profit_take")

    def test_profit_take_reason_over_time_exit(self) -> None:
        settings = _risk_settings(max_hold_minutes=100.0)
        old_entry = datetime(2020, 1, 1, tzinfo=timezone.utc)
        trade = _trade(
            id="ibkr-trade-2",
            entry_time=old_entry,
            execution_mode="ibkr",
            ibkr_parent_order_id=1,
            ibkr_sl_order_id=2,
            ibkr_tp_order_id=3,
        )
        quotes = {
            "META": Quote(symbol="META", price=107.0, bid=None, ask=None, spread=None),
        }
        trade_ids = collect_profit_take_trade_ids([trade], quotes, settings)
        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
            open_trades=[trade],
        )
        ibkr = MagicMock()
        ibkr.close_long_position.return_value = OrderFill(
            price=107.0, quantity=10.0, commission=0.0
        )
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0

        close_ibkr_signal_exits(
            ibkr,
            manager,
            db,
            profit_take_trade_ids=trade_ids,
            max_hold_minutes=100.0,
        )
        self.assertEqual(db.close_trade.call_args.kwargs["exit_reason"], "profit_take")


if __name__ == "__main__":
    unittest.main()
