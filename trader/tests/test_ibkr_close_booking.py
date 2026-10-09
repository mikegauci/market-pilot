from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from broker.execution import _record_ibkr_close, sync_ibkr_exits
from models.types import OrderFill, TradeRecord


def _trade() -> TradeRecord:
    return TradeRecord(
        id="t1",
        symbol="NVDA",
        side="buy",
        entry_time=datetime(2026, 10, 9, 14, 0, tzinfo=timezone.utc),
        entry_price=100.0,
        quantity=10,
        position_value=1000.0,
        stop_loss=99.0,
        take_profit=102.0,
        status="open",
        paper_or_live="paper",
        execution_mode="ibkr",
        ibkr_parent_order_id=1,
        ibkr_sl_order_id=2,
        ibkr_tp_order_id=3,
        entry_commission=1.0,
    )


class IbkrCloseBookingTests(unittest.TestCase):
    def _risk(self, trade: TradeRecord) -> MagicMock:
        risk = MagicMock()
        risk.open_trades = [trade]
        risk.estimate_ibkr_commission.return_value = 0.5
        return risk

    def test_bracket_exit_books_estimated_commission_without_fill_qty(self) -> None:
        trade = _trade()
        risk = self._risk(trade)
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 18.5
        ibkr = MagicMock()
        ibkr.get_bracket_exit_status.return_value = (102.0, "take_profit")

        self.assertTrue(sync_ibkr_exits(ibkr, risk, db, ibkr_account_id="DU1"))

        args, kwargs = db.close_trade.call_args
        self.assertEqual(args[0], "t1")
        self.assertEqual(args[1], 102.0)
        self.assertEqual(args[3:], (20.0, 18.5))
        self.assertEqual(kwargs, {"exit_reason": "take_profit", "filled_quantity": None})
        risk.estimate_ibkr_commission.assert_called_with(10.0, round_trip=False)
        risk.record_closed_pnl.assert_called_once_with(18.5)
        risk.remove_open_trade.assert_called_once_with("t1")
        risk.set_daily_realized_pnl.assert_called_once_with(18.5)

    def test_fill_close_uses_fill_commission_and_quantity(self) -> None:
        trade = _trade()
        risk = self._risk(trade)
        db = MagicMock()
        _record_ibkr_close(trade, OrderFill(price=99.0, quantity=4, commission=0.25), "eod_flatten", risk, db)
        args, kwargs = db.close_trade.call_args
        self.assertEqual(args[3:], (-4.0, -5.25))
        self.assertEqual(kwargs, {"exit_reason": "eod_flatten", "filled_quantity": 4})
        risk.estimate_ibkr_commission.assert_not_called()


if __name__ == "__main__":
    unittest.main()
