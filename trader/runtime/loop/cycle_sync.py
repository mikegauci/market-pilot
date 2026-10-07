from __future__ import annotations

import logging
import time
from typing import Callable, TYPE_CHECKING

from config import Settings
from database.supabase import SupabaseRepository
from execution_mode import effective_execution_mode
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.mock import MockMarketProvider
from models.types import DataSource
from risk.manager import RiskManager
from runtime.capital import sync_risk_manager_capital
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.state import TraderRuntimeState
from runtime.timing import should_refresh
from runtime.trader_ops import merge_watchlist_symbols, sync_watchlist_symbols
from strategy.config import (
    rotation_dashboard_override,
    entry_ema_dashboard_override,
    strategy_config_with_risk_overrides,
)
from strategy.confirmation import ConfirmationTracker
from strategy.profit_take_tracker import ProfitTakeBandTracker
from watchlist.backfill import backfill_watchlist_symbols
from watchlist.entry_blocks import apply_expired_entry_blocks
from watchlist.resolution import (
    effective_benchmark,
    resolve_rotation_scan_watchlist,
    resolve_runtime_watchlist,
)

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient

logger = logging.getLogger(__name__)


def run_cycle_sync(
    *,
    db: SupabaseRepository,
    settings: Settings,
    runtime: TraderRuntimeState,
    mock: MockMarketProvider,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    ibkr: "IBKRClient",
    risk_manager: RiskManager | None,
    confirmation_tracker: ConfirmationTracker,
    profit_take_tracker: ProfitTakeBandTracker,
    loss_cut_tracker: ProfitTakeBandTracker,
    scratch: EvalCycleScratch,
    news_client: object | None,
    last_general_news_refresh: float,
    start_general_news_refresh: Callable[[], None],
) -> None:
    if db.poll_shutdown_requested():
        logger.info("Shutdown requested from dashboard — stopping trading engine")
        runtime.shutdown_requested = True

    now_mono = time.monotonic()
    if should_refresh(
        now_mono,
        scratch.last_bot_control_sync,
        settings.bot_control_refresh_interval_sec,
    ):
        bot_control = db.get_bot_control(settings.execution_mode)
        scratch.bot_enabled = bot_control.enabled
        scratch.trading_mode = bot_control.trading_mode
        scratch.configured_execution_mode = bot_control.execution_mode
        scratch.execution_mode = effective_execution_mode(
            settings.data_source, scratch.configured_execution_mode
        )
        scratch.last_bot_control_sync = now_mono

    if (
        news_client is not None
        and should_refresh(
            now_mono,
            last_general_news_refresh,
            settings.news_general_refresh_sec,
        )
    ):
        start_general_news_refresh()

    if should_refresh(
        now_mono,
        scratch.last_settings_sync,
        settings.settings_refresh_interval_sec,
    ):
        scratch.risk_settings = db.get_risk_settings()
        prev_cycles = scratch.strategy_config.confirmation_cycles
        prev_seconds = scratch.strategy_config.confirmation_seconds
        scratch.strategy_config = strategy_config_with_risk_overrides(
            settings.strategy_config,
            min_volume_ratio=scratch.risk_settings.min_volume_ratio,
            min_share_price=scratch.risk_settings.min_share_price,
            min_dollar_volume=scratch.risk_settings.min_dollar_volume,
            jev_sell_exit_threshold=scratch.risk_settings.jev_sell_exit_threshold,
            confirmation_cycles=scratch.risk_settings.confirmation_cycles,
            confirmation_seconds=scratch.risk_settings.confirmation_seconds,
            **rotation_dashboard_override(
                from_settings=scratch.risk_settings.rotation_session_pct_from_settings,
                value=scratch.risk_settings.rotation_min_session_change_pct,
            ),
            **entry_ema_dashboard_override(
                from_settings=scratch.risk_settings.entry_ema_gate_from_settings,
                value=scratch.risk_settings.entry_ema_gate,
            ),
        )
        if (
            scratch.strategy_config.confirmation_cycles != prev_cycles
            or scratch.strategy_config.confirmation_seconds != prev_seconds
        ):
            confirmation_tracker.reconfigure(
                scratch.strategy_config.confirmation_cycles,
                scratch.strategy_config.confirmation_seconds,
            )
        profit_take_tracker.reconfigure(
            scratch.risk_settings.profit_take_band_window_cycles,
        )
        loss_cut_tracker.reconfigure(
            scratch.risk_settings.loss_cut_band_window_cycles,
        )
        scratch.last_settings_sync = now_mono

    updated_blocks, expired_blocks = apply_expired_entry_blocks(scratch.risk_settings)
    if expired_blocks and db is not None:
        note = f"unblocked {', '.join(expired_blocks)} (timed)"
        db.save_entry_block_state(
            updated_blocks.entry_blocked_symbols,
            updated_blocks.entry_blocked_at,
            watchlist_active=updated_blocks.watchlist_active
            if updated_blocks.watchlist_rotation_enabled
            else None,
            rotation_note=note
            if updated_blocks.watchlist_rotation_enabled
            else None,
        )
        scratch.risk_settings = updated_blocks

    benchmark_symbol = effective_benchmark(scratch.risk_settings)
    scratch.benchmark_symbol = benchmark_symbol
    open_symbols = (
        [t.symbol for t in risk_manager.open_trades] if risk_manager else []
    )
    scratch.open_symbols = open_symbols
    manual_watchlist = resolve_runtime_watchlist(
        scratch.risk_settings,
        open_symbols,
        env_fallback=settings.watchlist_symbols,
    )
    if (
        scratch.risk_settings.watchlist_rotation_enabled
        and scratch.risk_settings.watchlist_pool
    ):
        scratch.watchlist = resolve_rotation_scan_watchlist(scratch.risk_settings)
        quote_symbols = list(
            dict.fromkeys(
                list(scratch.risk_settings.watchlist_pool)
                + scratch.watchlist
                + open_symbols
            )
        )
    else:
        scratch.watchlist = manual_watchlist
        quote_symbols = list(dict.fromkeys(scratch.watchlist + open_symbols))
    scratch.all_symbols = merge_watchlist_symbols(quote_symbols, benchmark_symbol)
    new_watchlist_symbols = sync_watchlist_symbols(
        scratch.all_symbols,
        mock,
        minute_bars,
        bar_store,
        settings.data_source,
        runtime,
    )
    if (
        new_watchlist_symbols
        and settings.data_source == DataSource.IBKR
        and ibkr.is_connected()
    ):
        backfill_watchlist_symbols(
            settings,
            bar_store,
            ibkr,
            new_watchlist_symbols,
            open_symbols=open_symbols,
        )
    if settings.data_source == DataSource.IBKR and ibkr.is_connected():
        ibkr.sync_watchlist_subscriptions(scratch.all_symbols)
    if risk_manager:
        risk_manager.update_settings(scratch.risk_settings)
        sync_risk_manager_capital(
            risk_manager,
            ibkr,
            scratch.risk_settings.account_capital,
        )
