import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, call

from broker.manual_close import (
    _persist_manual_close,
    process_manual_close_commands,
)
from models.types import ClosedTrade, ExecutionMode, Quote, TradeRecord


def _trade(**overrides: object) -> TradeRecord:
    base = {
        "id": "trade-1",
        "symbol": "AAPL",
        "side": "buy",
        "entry_time": datetime.now(timezone.utc),
        "entry_price": 100.0,
        "quantity": 1.0,
        "position_value": 100.0,
        "stop_loss": 99.0,
        "take_profit": 101.0,
        "status": "open",
        "paper_or_live": "paper",
        "execution_mode": "simulated",
    }
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class ManualCloseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = MagicMock()
        self.risk_manager = MagicMock()
        self.ibkr = MagicMock()
        self.trade = _trade()
        self.risk_manager.open_trades = [self.trade]

    def test_closes_simulated_trade_at_market(self) -> None:
        self.db.get_pending_trade_commands.return_value = [
            {"id": "cmd-1", "trade_id": "trade-1"}
        ]
        self.db.claim_trade_command.return_value = True
        self.risk_manager._build_closed_trade.return_value = ClosedTrade(
            trade_id="trade-1",
            symbol="AAPL",
            exit_price=102.0,
            exit_time=datetime.now(timezone.utc),
            gross_pnl=2.0,
            net_pnl=2.0,
            reason="manual",
        )

        quotes = {
            "AAPL": Quote(symbol="AAPL", price=102.0, bid=None, ask=None, spread=None),
        }

        dirty = process_manual_close_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            quotes,
        )

        self.assertTrue(dirty)
        self.db.close_trade.assert_called_once()
        self.risk_manager.remove_open_trade.assert_called_with("trade-1")
        self.db.complete_trade_command.assert_called_once_with("cmd-1")

    def test_fails_when_trade_not_open(self) -> None:
        self.risk_manager.open_trades = []
        self.db.get_open_trades.return_value = []
        self.db.get_pending_trade_commands.return_value = [
            {"id": "cmd-1", "trade_id": "trade-1"}
        ]
        self.db.claim_trade_command.return_value = True

        dirty = process_manual_close_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            {},
        )

        self.assertFalse(dirty)
        self.db.fail_trade_command.assert_called_once_with("cmd-1", "trade_not_open")

    def test_closes_ibkr_trade_with_partial_fill(self) -> None:
        ibkr_trade = _trade(
            execution_mode="ibkr",
            quantity=16.0,
            ibkr_parent_order_id=1,
            ibkr_sl_order_id=2,
            ibkr_tp_order_id=3,
        )
        self.risk_manager.open_trades = [ibkr_trade]
        self.ibkr.is_connected.return_value = True
        from models.types import OrderFill

        self.ibkr.close_long_position.return_value = OrderFill(
            price=101.5, quantity=10.0, commission=1.0
        )
        self.db.get_pending_trade_commands.return_value = [
            {"id": "cmd-1", "trade_id": "trade-1"}
        ]
        self.db.claim_trade_command.return_value = True

        dirty = process_manual_close_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.IBKR,
            {},
            fill_timeout_sec=30.0,
        )

        self.assertTrue(dirty)
        self.ibkr.close_long_position.assert_called_once()
        self.db.close_trade.assert_called_once()
        kwargs = self.db.close_trade.call_args.kwargs
        self.assertEqual(kwargs.get("filled_quantity"), 10.0)

    def test_ibkr_trade_fails_in_simulated_mode(self) -> None:
        ibkr_trade = _trade(execution_mode="ibkr")
        self.risk_manager.open_trades = [ibkr_trade]
        self.db.get_pending_trade_commands.return_value = [
            {"id": "cmd-1", "trade_id": "trade-1"}
        ]
        self.db.claim_trade_command.return_value = True

        dirty = process_manual_close_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            {},
        )

        self.assertFalse(dirty)
        self.db.fail_trade_command.assert_called_once_with(
            "cmd-1", "ibkr_execution_required"
        )
        self.ibkr.close_long_position.assert_not_called()

    def test_reclaims_stale_commands_before_processing(self) -> None:
        self.db.reclaim_stale_trade_commands.return_value = 2
        self.db.get_pending_trade_commands.return_value = []

        dirty = process_manual_close_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            {},
        )

        self.assertFalse(dirty)
        self.db.reclaim_stale_trade_commands.assert_called_once()

    def test_db_persist_retries_then_fails_gracefully(self) -> None:
        closed = ClosedTrade(
            trade_id="trade-1",
            symbol="AAPL",
            exit_price=101.0,
            exit_time=datetime.now(timezone.utc),
            gross_pnl=1.0,
            net_pnl=1.0,
            reason="manual",
            filled_quantity=1.0,
        )
        self.db.close_trade.side_effect = [RuntimeError("db down"), RuntimeError("db down")]

        sync_needed = _persist_manual_close(
            self.db, self.risk_manager, "cmd-1", closed
        )

        self.assertTrue(sync_needed)
        self.assertEqual(self.db.close_trade.call_count, 2)
        self.risk_manager.remove_open_trade.assert_called_with("trade-1")
        self.db.fail_trade_command.assert_called_once()
        self.db.complete_trade_command.assert_not_called()

    def test_db_persist_succeeds_on_second_attempt(self) -> None:
        closed = ClosedTrade(
            trade_id="trade-1",
            symbol="AAPL",
            exit_price=101.0,
            exit_time=datetime.now(timezone.utc),
            gross_pnl=1.0,
            net_pnl=1.0,
            reason="manual",
        )
        self.db.close_trade.side_effect = [RuntimeError("transient"), None]

        sync_needed = _persist_manual_close(
            self.db, self.risk_manager, "cmd-1", closed
        )

        self.assertTrue(sync_needed)
        self.assertEqual(self.db.close_trade.call_count, 2)
        self.db.complete_trade_command.assert_called_once_with("cmd-1")


if __name__ == "__main__":
    unittest.main()
