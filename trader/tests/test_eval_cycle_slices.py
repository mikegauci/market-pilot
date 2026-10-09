from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from config import load_settings
from models.types import DataSource, ExecutionMode, TradingMode
from runtime.loop.cycle_sync import run_cycle_sync
from runtime.loop.eval_cycle import EvalCycleContext
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig


class EvalCycleSliceTests(unittest.TestCase):
    def test_scratch_round_trips_context_fields(self) -> None:
        settings = load_settings()
        db = MagicMock()
        db.poll_shutdown_requested.return_value = False
        ctx = EvalCycleContext(
            runtime=TraderRuntimeState(),
            settings=settings,
            db=db,
            mock=MagicMock(),
            minute_bars=MagicMock(),
            bar_store=MagicMock(),
            ibkr=MagicMock(),
            jev=None,
            news_service=None,
            risk_manager=None,
            confirmation_tracker=MagicMock(),
            profit_take_tracker=MagicMock(),
            loss_cut_tracker=MagicMock(),
            bot_enabled=False,
            trading_mode=TradingMode.LIVE,
            configured_execution_mode=ExecutionMode.IBKR,
            execution_mode=ExecutionMode.IBKR,
            last_bot_control_sync=1.0,
            last_settings_sync=2.0,
            last_heartbeat=3.0,
            last_portfolio_history=4.0,
            last_live_bar_flush=5.0,
            active_ibkr_account_id="DU123",
            jev_connected=True,
            risk_settings=MagicMock(),
            strategy_config=StrategyConfig(),
            watchlist=["AAPL"],
            all_symbols=["AAPL", "SPY"],
            data_source_label="mock",
        )
        scratch = EvalCycleScratch.from_context(ctx)
        scratch.bot_enabled = True
        scratch.watchlist = ["MSFT"]
        scratch.apply_to_context(ctx)
        self.assertTrue(ctx.bot_enabled)
        self.assertEqual(ctx.watchlist, ["MSFT"])
        self.assertEqual(ctx.last_settings_sync, 2.0)

    def _run_sync(self, *, refresh: bool, shutdown_requested: bool):
        settings = load_settings()
        settings.data_source = DataSource.MOCK
        db = MagicMock()
        db.poll_shutdown_requested.return_value = shutdown_requested
        db.get_bot_control.return_value = MagicMock(
            enabled=False,
            trading_mode=TradingMode.PAPER,
            execution_mode=ExecutionMode.SIMULATED,
            shutdown_requested=shutdown_requested,
        )
        db.get_risk_settings.return_value = MagicMock(
            min_volume_ratio=0.5,
            min_share_price=0.0,
            min_dollar_volume=0.0,
            jev_sell_exit_threshold=0.95,
            confirmation_cycles=1,
            confirmation_seconds=0.0,
            watchlist_rotation_enabled=False,
            watchlist_pool=[],
            watchlist_active=[],
            max_hold_minutes=0.0,
            profit_take_band_window_cycles=3,
            account_capital=10_000.0,
        )
        scratch = EvalCycleScratch(
            bot_enabled=True,
            trading_mode=TradingMode.LIVE,
            configured_execution_mode=ExecutionMode.IBKR,
            execution_mode=ExecutionMode.IBKR,
            last_bot_control_sync=0.0,
            last_settings_sync=0.0,
            last_heartbeat=0.0,
            last_portfolio_history=0.0,
            last_live_bar_flush=0.0,
            active_ibkr_account_id=None,
            jev_connected=False,
            risk_settings=db.get_risk_settings.return_value,
            strategy_config=StrategyConfig(),
            watchlist=[],
            all_symbols=[],
        )
        runtime = TraderRuntimeState()
        with patch("runtime.loop.cycle_sync.sync_watchlist_symbols", return_value=[]), patch(
            "runtime.loop.cycle_sync.should_refresh", return_value=refresh
        ):
            run_cycle_sync(
                db=db,
                settings=settings,
                runtime=runtime,
                mock=MagicMock(),
                minute_bars=MagicMock(),
                bar_store=MagicMock(),
                ibkr=MagicMock(),
                risk_manager=None,
                confirmation_tracker=MagicMock(),
                profit_take_tracker=MagicMock(),
                loss_cut_tracker=MagicMock(),
                scratch=scratch,
                news_client=None,
                last_general_news_refresh=0.0,
                start_general_news_refresh=MagicMock(),
            )
        return db, runtime, scratch


    def test_sync_phase_updates_bot_control(self) -> None:
        db, runtime, scratch = self._run_sync(refresh=True, shutdown_requested=False)
        self.assertFalse(scratch.bot_enabled)
        self.assertEqual(scratch.trading_mode, TradingMode.PAPER)
        self.assertFalse(runtime.shutdown_requested)

    def test_bot_control_refresh_reads_bot_status_once(self) -> None:
        db, runtime, _ = self._run_sync(refresh=True, shutdown_requested=True)
        db.poll_shutdown_requested.assert_not_called()
        self.assertTrue(runtime.shutdown_requested)

    def test_shutdown_polled_between_bot_control_refreshes(self) -> None:
        db, runtime, _ = self._run_sync(refresh=False, shutdown_requested=True)
        db.get_bot_control.assert_not_called()
        db.poll_shutdown_requested.assert_called_once()
        self.assertTrue(runtime.shutdown_requested)

if __name__ == "__main__":
    unittest.main()
