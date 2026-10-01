from __future__ import annotations

import unittest

from models.types import RiskSettings, TradingMode
from risk.manager import RiskManager
from tests.test_check_exits import _risk_settings


class RiskIbkrBuyingPowerTests(unittest.TestCase):
    def test_available_cash_prefers_ibkr_buying_power(self) -> None:
        settings = _risk_settings()
        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=100_000.0,
        )
        manager.set_ibkr_buying_power(12_000.0)
        self.assertEqual(manager._available_cash(), 12_000.0)

    def test_clearing_buying_power_restores_simulated_formula(self) -> None:
        settings = _risk_settings()
        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )
        manager.set_ibkr_buying_power(1_000.0)
        manager.set_ibkr_buying_power(None)
        self.assertEqual(manager._available_cash(), 10_000.0)


if __name__ == "__main__":
    unittest.main()
