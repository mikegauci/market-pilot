from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from broker.ibkr import IBKRClient


def _value(tag: str, value: str, currency: str = "EUR") -> SimpleNamespace:
    return SimpleNamespace(tag=tag, value=value, currency=currency)


class TestIBKRAccountSummary(unittest.TestCase):
    def setUp(self) -> None:
        self.client = IBKRClient("127.0.0.1", 4002, client_id=99, account="DUR217910")
        self.client.account = "DUR217910"

    @patch.object(IBKRClient, "_sync_session_account", return_value="DUR217910")
    def test_get_account_summary_includes_accrued_cash(self, _account: MagicMock) -> None:
        self.client.ib = MagicMock()
        self.client.ib.accountValues.return_value = [
            _value("NetLiquidation", "999980.68"),
            _value("TotalCashValue", "999793.88"),
            _value("BuyingPower", "3990000"),
            _value("AccruedCash", "186.80"),
            _value("UnrealizedPnL", "0"),
            _value("RealizedPnL", "46.78"),
            _value("DailyPnL", "46.78"),
        ]

        summary = self.client.get_account_summary()

        self.assertEqual(summary.account_id, "DUR217910")
        self.assertAlmostEqual(summary.net_liquidation, 999980.68)
        self.assertAlmostEqual(summary.ibkr_accrued_cash or 0, 186.80)


if __name__ == "__main__":
    unittest.main()
