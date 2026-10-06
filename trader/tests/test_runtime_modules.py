from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from broker.ibkr import IBKRClient
from models.types import AccountSummary, ClosedTrade, Quote, RiskSettings, TradingMode
from risk.manager import RiskManager
from runtime.capital import sync_risk_manager_capital
from runtime.heartbeat import run_heartbeat_cycle
from runtime.sim_close import persist_simulated_closes
from runtime.startup import connect_ibkr_with_retries
from runtime.state import TraderRuntimeState


class CapitalSyncTests(unittest.TestCase):
    def test_sync_sets_buying_power_from_ibkr(self) -> None:
        ibkr = MagicMock(spec=IBKRClient)
        ibkr.is_connected.return_value = True
        ibkr.get_account_summary.return_value = AccountSummary(
            account_id="DU123",
            net_liquidation=25_000.0,
            total_cash=10_000.0,
            buying_power=12_000.0,
        )
        manager = RiskManager(
            settings=RiskSettings(
                minimum_jev_confidence=0.85,
                signal_record_threshold=0.75,
                risk_per_trade=100.0,
                max_position_size=10_000.0,
                max_daily_loss=500.0,
                max_open_positions=5,
                stop_loss_percentage=0.01,
                take_profit_percentage=0.015,
                max_hold_minutes=0.0,
                account_capital=10_000.0,
                risk_sync_equity=None,
                watchlist=["NVDA"],
            ),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )

        sync_risk_manager_capital(manager, ibkr, fallback_capital=10_000.0)

        self.assertEqual(manager.effective_capital, 25_000.0)
        self.assertEqual(manager._available_cash(), 12_000.0)


class StartupConnectTests(unittest.TestCase):
    def test_connect_retries_until_success(self) -> None:
        client = MagicMock()
        client.connect.side_effect = [RuntimeError("fail"), None]

        self.assertTrue(connect_ibkr_with_retries(client, max_attempts=2, delay_sec=0))

    def test_connect_returns_false_after_exhausted_attempts(self) -> None:
        client = MagicMock()
        client.connect.side_effect = RuntimeError("fail")

        self.assertFalse(connect_ibkr_with_retries(client, max_attempts=2, delay_sec=0))


class SimCloseTests(unittest.TestCase):
    def test_persist_simulated_closes_updates_daily_pnl(self) -> None:
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 42.0
        manager = MagicMock()
        closed = ClosedTrade(
            trade_id="t1",
            symbol="NVDA",
            exit_price=101.0,
            exit_time=datetime.now(timezone.utc),
            gross_pnl=10.0,
            net_pnl=9.0,
            reason="take_profit",
        )

        changed = persist_simulated_closes(db, manager, [closed])

        self.assertTrue(changed)
        db.close_trade.assert_called_once()
        manager.set_daily_realized_pnl.assert_called_with(42.0)


class HeartbeatCycleTests(unittest.TestCase):
    def test_skips_write_before_interval(self) -> None:
        db = MagicMock()
        settings = MagicMock()
        settings.heartbeat_interval_sec = 60.0
        ibkr = MagicMock(spec=IBKRClient)
        ibkr.is_connected.return_value = False

        last_h, last_ph, acct = run_heartbeat_cycle(
            db=db,
            settings=settings,
            ibkr=ibkr,
            risk_manager=None,
            risk_settings=MagicMock(),
            quotes=[],
            quotes_by_symbol={},
            bot_enabled=True,
            trading_mode=TradingMode.PAPER,
            configured_execution_mode=MagicMock(),
            execution_mode=MagicMock(),
            jev_connected_this_cycle=False,
            jev_connected=False,
            active_ibkr_account_id=None,
            last_heartbeat=100.0,
            last_portfolio_history=0.0,
            now_mono=120.0,
        )

        self.assertEqual(last_h, 100.0)
        db.write_heartbeat.assert_not_called()


if __name__ == "__main__":
    unittest.main()
