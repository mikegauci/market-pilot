import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from broker.execution import reconcile_flat_ibkr_trades
from models.types import Quote, TradeRecord


def _ibkr_trade(**overrides: object) -> TradeRecord:
    base = {
        "id": "trade-1",
        "symbol": "AAPL",
        "side": "buy",
        "entry_time": datetime.now(timezone.utc),
        "entry_price": 100.0,
        "quantity": 14.0,
        "position_value": 1400.0,
        "stop_loss": 99.0,
        "take_profit": 101.0,
        "status": "open",
        "paper_or_live": "paper",
        "execution_mode": "ibkr",
        "ibkr_parent_order_id": 1,
        "ibkr_sl_order_id": 2,
        "ibkr_tp_order_id": 3,
    }
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class ReconcileFlatIbkrTradesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ibkr = MagicMock()
        self.risk_manager = MagicMock()
        self.db = MagicMock()
        self.trade = _ibkr_trade()
        self.risk_manager.open_trades = [self.trade]

    def test_closes_open_trade_when_broker_is_flat(self) -> None:
        self.ibkr.is_connected.return_value = True
        self.ibkr.get_positions.return_value = []
        self.ibkr.get_bracket_exit_status.return_value = (99.5, "stop_loss")
        quotes = {
            "AAPL": Quote(symbol="AAPL", price=100.0, bid=None, ask=None, spread=None),
        }

        dirty = reconcile_flat_ibkr_trades(
            self.ibkr,
            self.risk_manager,
            self.db,
            quotes,
            open_orders_synced=True,
        )

        self.assertTrue(dirty)
        self.ibkr.get_bracket_exit_status.assert_called_once()
        _, kwargs = self.ibkr.get_bracket_exit_status.call_args
        self.assertTrue(kwargs.get("open_orders_synced"))
        self.db.close_trade.assert_called_once()
        kwargs = self.db.close_trade.call_args.kwargs
        self.assertEqual(kwargs.get("exit_reason"), "stop_loss")
        self.risk_manager.remove_open_trade.assert_called_with("trade-1")

    def test_skips_when_broker_still_long(self) -> None:
        from models.types import Position

        self.ibkr.is_connected.return_value = True
        self.ibkr.get_positions.return_value = [
            Position(
                symbol="AAPL",
                quantity=14.0,
                avg_cost=100.0,
                market_price=100.0,
                market_value=1400.0,
                unrealized_pnl=0.0,
            )
        ]

        dirty = reconcile_flat_ibkr_trades(
            self.ibkr,
            self.risk_manager,
            self.db,
            {},
        )

        self.assertFalse(dirty)
        self.db.close_trade.assert_not_called()


if __name__ == "__main__":
    unittest.main()
