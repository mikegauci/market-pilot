import time
import unittest
from unittest.mock import MagicMock

from broker.reconcile import refresh_ibkr_bracket_targets
from models.types import BracketLegs


class RefreshIbkrBracketTargetsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ibkr = MagicMock()
        self.ibkr.is_connected.return_value = True
        self.db = MagicMock()
        self.trade = MagicMock()
        self.trade.execution_mode = "ibkr"
        self.trade.symbol = "AAPL"
        self.trade.ibkr_sl_order_id = 2
        self.trade.ibkr_tp_order_id = 3
        self.trade.stop_loss = 99.0
        self.trade.take_profit = 101.0
        self.risk_manager = MagicMock()
        self.risk_manager.open_trades = [self.trade]

    def test_throttles_target_price_sync_within_interval(self) -> None:
        updated, last_mono = refresh_ibkr_bracket_targets(
            self.ibkr,
            self.risk_manager,
            self.db,
            open_orders_synced=True,
            target_refresh_interval_sec=15.0,
            last_target_refresh_mono=time.monotonic(),
        )

        self.assertEqual(updated, 0)
        self.ibkr.find_open_bracket_legs.assert_not_called()

    def test_still_attaches_missing_bracket_ids_when_throttled(self) -> None:
        self.trade.ibkr_sl_order_id = None
        self.trade.ibkr_tp_order_id = None
        self.ibkr.find_open_bracket_legs.return_value = BracketLegs(
            parent_order_id=1,
            sl_order_id=2,
            tp_order_id=3,
            stop_loss=98.0,
            take_profit=102.0,
        )

        updated, _ = refresh_ibkr_bracket_targets(
            self.ibkr,
            self.risk_manager,
            self.db,
            open_orders_synced=True,
            target_refresh_interval_sec=15.0,
            last_target_refresh_mono=time.monotonic(),
        )

        self.assertEqual(updated, 1)
        self.ibkr.find_open_bracket_legs.assert_called_once()
        self.db.update_trade_ibkr_bracket.assert_called_once_with(self.trade)


if __name__ == "__main__":
    unittest.main()
