from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from config import load_settings
from models.types import DataSource, ExecutionMode, TradingMode
from runtime.loop.eval_cycle import EvalCycleContext, run_eval_cycle
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig


class EvalCycleSmokeTests(unittest.TestCase):
    def _context(self, *, news_client: object | None = None) -> EvalCycleContext:
        settings = load_settings()
        # Large refresh intervals skip Supabase work; sleep intervals must stay 0
        # or run_eval_cycle blocks in interruptible_sleep (~interval - elapsed).
        settings.bot_control_refresh_interval_sec = 1e9
        settings.settings_refresh_interval_sec = 1e9
        settings.news_general_refresh_sec = 1e9
        settings.live_bar_flush_interval_sec = 1e9
        settings.heartbeat_interval_sec = 0.0
        settings.eval_interval_sec = 0.0
        settings.closed_market_eval_interval_sec = 0.0
        settings.data_source = DataSource.MOCK

        db = MagicMock()
        db.poll_shutdown_requested.return_value = False
        db.get_bot_control.return_value = MagicMock(
            enabled=True,
            trading_mode=TradingMode.PAPER,
            execution_mode=ExecutionMode.SIMULATED,
            shutdown_requested=False,
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

        mock = MagicMock()
        mock.get_quotes.return_value = []

        minute_bars = MagicMock()
        minute_bars.get.return_value = MagicMock(bar_count=lambda: 1, change_pct=lambda *a, **k: 0.0)

        bar_store = MagicMock()
        bar_store.get_intraday_bars.return_value = []
        bar_store.get_trend_changes.return_value = []

        ibkr = MagicMock()
        ibkr.is_connected.return_value = False

        return EvalCycleContext(
            runtime=TraderRuntimeState(),
            settings=settings,
            db=db,
            mock=mock,
            minute_bars=minute_bars,
            bar_store=bar_store,
            ibkr=ibkr,
            jev=None,
            news_service=None,
            news_client=news_client,
            last_general_news_refresh=0.0,
            risk_manager=None,
            confirmation_tracker=MagicMock(),
            profit_take_tracker=MagicMock(),
            loss_cut_tracker=MagicMock(),
            bot_enabled=True,
            trading_mode=TradingMode.PAPER,
            configured_execution_mode=ExecutionMode.SIMULATED,
            execution_mode=ExecutionMode.SIMULATED,
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
            data_source_label="mock",
        )

    @patch("market.hours.is_us_regular_session_open", return_value=False)
    def test_cycle_with_news_client_does_not_record_error(
        self, _market_open: MagicMock
    ) -> None:
        ctx = self._context(news_client=MagicMock())
        run_eval_cycle(ctx, start_general_news_refresh=MagicMock())
        ctx.db.record_error.assert_not_called()

    @patch("market.hours.is_us_regular_session_open", return_value=False)
    def test_cycle_without_news_client_does_not_record_error(
        self, _market_open: MagicMock
    ) -> None:
        ctx = self._context(news_client=None)
        run_eval_cycle(ctx, start_general_news_refresh=MagicMock())
        ctx.db.record_error.assert_not_called()


if __name__ == "__main__":
    unittest.main()
