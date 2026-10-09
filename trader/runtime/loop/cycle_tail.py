from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from config import Settings
from database.supabase import SupabaseRepository
from risk.manager import RiskManager
from runtime.heartbeat import run_heartbeat_cycle
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.state import TraderRuntimeState
from runtime.status_log import log_trader_running
from runtime.timing import apply_error_backoff, compute_loop_sleep_sec, should_refresh
from runtime.trader_ops import interruptible_sleep

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from runtime.loop.eval_cycle import EvalCycleContext

logger = logging.getLogger(__name__)

CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0


def run_cycle_heartbeat_and_status(
    *,
    db: SupabaseRepository | None,
    settings: Settings,
    ibkr: "IBKRClient",
    risk_manager: RiskManager | None,
    scratch: EvalCycleScratch,
    runtime: TraderRuntimeState,
    data_source_label: str,
) -> None:
    now = time.monotonic()
    if db:
        (
            scratch.last_heartbeat,
            scratch.last_portfolio_history,
            scratch.active_ibkr_account_id,
        ) = run_heartbeat_cycle(
            db=db,
            settings=settings,
            ibkr=ibkr,
            risk_manager=risk_manager,
            risk_settings=scratch.risk_settings,
            quotes=scratch.quotes,
            quotes_by_symbol=scratch.quotes_by_symbol,
            bot_enabled=scratch.bot_enabled,
            trading_mode=scratch.trading_mode,
            configured_execution_mode=scratch.configured_execution_mode,
            execution_mode=scratch.execution_mode,
            jev_connected_this_cycle=scratch.jev_connected_this_cycle,
            jev_connected=scratch.jev_connected,
            active_ibkr_account_id=scratch.active_ibkr_account_id,
            last_heartbeat=scratch.last_heartbeat,
            last_portfolio_history=scratch.last_portfolio_history,
            now_mono=now,
        )

    if should_refresh(
        now,
        runtime.last_trader_status_log_mono,
        CLOSED_MARKET_LOG_INTERVAL_SEC,
    ):
        runtime.last_trader_status_log_mono = now
        log_trader_running(
            bot_enabled=scratch.bot_enabled,
            market_open=scratch.market_open,
            ibkr_connected=ibkr.is_connected(),
            jev_connected=scratch.jev_connected_this_cycle or scratch.jev_connected,
            execution_mode=scratch.execution_mode,
            open_trades=len(risk_manager.open_trades) if risk_manager else 0,
            ibkr_account_id=scratch.active_ibkr_account_id,
            data_source=data_source_label,
        )


def finish_eval_cycle_sleep(
    *,
    ctx: "EvalCycleContext",
    scratch: EvalCycleScratch,
    settings: Settings,
    runtime: TraderRuntimeState,
    loop_start: float,
) -> None:
    elapsed = time.monotonic() - loop_start
    if scratch.market_open:
        runtime.cycle_elapsed_sec.append(elapsed)
        if len(runtime.cycle_elapsed_sec) > 30:
            runtime.cycle_elapsed_sec = runtime.cycle_elapsed_sec[-30:]
    interval = (
        settings.eval_interval_sec
        if scratch.market_open
        else settings.closed_market_eval_interval_sec
    )
    sleep_for = compute_loop_sleep_sec(
        interval,
        elapsed,
        scratch.last_heartbeat,
        time.monotonic(),
        settings.heartbeat_interval_sec,
        track_heartbeat=ctx.db is not None,
    )
    sleep_for = apply_error_backoff(sleep_for, runtime.consecutive_cycle_failures)
    scratch.apply_to_context(ctx)
    if sleep_for > 0 and not runtime.shutdown_requested:
        interruptible_sleep(sleep_for, runtime)
