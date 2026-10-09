from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from models.types import TradingMode
from risk.manager import RiskManager
from tests.fake_supabase import fake_repository
from tests.settings_row_fixtures import SCENARIOS, SchemaSettingsClient


class DailyPnlSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        risk = fake_repository(SchemaSettingsClient(SCENARIOS["full"]())).get_risk_settings()
        self.manager = RiskManager(
            settings=risk, trading_mode=TradingMode.PAPER, effective_capital=10_000.0
        )
        self.manager.set_daily_realized_pnl(12.5)

    def test_same_day_does_not_query_trades(self) -> None:
        load = MagicMock(return_value=99.0)
        self.manager.sync_daily_realized_for_trading_day(load)
        load.assert_not_called()
        self.assertEqual(self.manager.daily_realized_pnl, 12.5)

    def test_new_day_reloads_from_trades(self) -> None:
        load = MagicMock(return_value=-3.0)
        with patch("risk.manager.trading_calendar_date", return_value=date(2099, 1, 2)):
            self.manager.sync_daily_realized_for_trading_day(load)
        load.assert_called_once()
        self.assertEqual(self.manager.daily_realized_pnl, -3.0)


if __name__ == "__main__":
    unittest.main()
