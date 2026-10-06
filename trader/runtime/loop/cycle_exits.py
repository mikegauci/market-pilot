from __future__ import annotations

import time
from typing import TYPE_CHECKING

from broker.execution import (
    EOD_RETRY_SEC,
    force_eod_ibkr_exits,
    reconcile_flat_ibkr_trades,
    sync_ibkr_exits,
)
from broker.reconcile import refresh_ibkr_bracket_targets
from config import Settings
from database.supabase import SupabaseRepository
from market.hours import is_us_regular_session_open, should_force_eod_flatten
from models.types import ExecutionMode
from risk.manager import RiskManager
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.sim_close import persist_simulated_closes
from runtime.state import TraderRuntimeState
from runtime.trader_ops import sync_portfolio_state
from strategy.config import StrategyConfig

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient


def run_cycle_exits(
    *,
    db: SupabaseRepository | None,
    settings: Settings,
    ibkr: "IBKRClient",
    risk_manager: RiskManager | None,
    scratch: EvalCycleScratch,
    strategy_config: StrategyConfig,
    runtime: TraderRuntimeState,
) -> None:
    if not (risk_manager and db):
        return

    max_hold = float(scratch.risk_settings.max_hold_minutes)

    def _max_hold_for_symbol(symbol: str) -> float:
        return max_hold

    closed = risk_manager.check_exits(
        scratch.quotes_by_symbol,
        max_hold_for_symbol=_max_hold_for_symbol,
    )
    if persist_simulated_closes(
        db,
        risk_manager,
        closed,
        daily_pnl_account_id=scratch.daily_pnl_account_id,
    ):
        scratch.portfolio_dirty = True

    if is_us_regular_session_open() and should_force_eod_flatten(
        flatten_minutes_before_close=strategy_config.eod_flatten_minutes_before_close
    ):
        eod_closed: list = []
        now_eod_mono = time.monotonic()
        if (now_eod_mono - runtime.eod_sim_last_attempt_mono) >= EOD_RETRY_SEC:
            runtime.eod_sim_last_attempt_mono = now_eod_mono
            eod_closed = risk_manager.force_close_all_simulated(
                scratch.quotes_by_symbol,
                reason="eod_flatten",
            )
        if persist_simulated_closes(
            db,
            risk_manager,
            eod_closed,
            daily_pnl_account_id=scratch.daily_pnl_account_id,
        ):
            scratch.portfolio_dirty = True
        if (
            scratch.execution_mode == ExecutionMode.IBKR
            and ibkr.is_connected()
            and force_eod_ibkr_exits(
                ibkr,
                risk_manager,
                db,
                fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                ibkr_account_id=scratch.daily_pnl_account_id,
                eod_last_attempt_mono=runtime.eod_ibkr_last_attempt_mono,
            )
        ):
            scratch.portfolio_dirty = True

    if scratch.execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
        ibkr.sync_open_orders()
        orders_synced = True
        if sync_ibkr_exits(
            ibkr,
            risk_manager,
            db,
            ibkr_account_id=scratch.daily_pnl_account_id,
            open_orders_synced=orders_synced,
        ):
            scratch.portfolio_dirty = True
        if reconcile_flat_ibkr_trades(
            ibkr,
            risk_manager,
            db,
            scratch.quotes_by_symbol,
            ibkr_account_id=scratch.daily_pnl_account_id,
            open_orders_synced=orders_synced,
        ):
            scratch.portfolio_dirty = True
        _, runtime.last_ibkr_bracket_target_refresh_mono = refresh_ibkr_bracket_targets(
            ibkr,
            risk_manager,
            db,
            open_orders_synced=orders_synced,
            last_target_refresh_mono=runtime.last_ibkr_bracket_target_refresh_mono,
        )

    if scratch.portfolio_dirty and db:
        sync_portfolio_state(
            db,
            ibkr,
            risk_manager,
            scratch.execution_mode,
            scratch.quotes,
        )
        scratch.portfolio_dirty = False
