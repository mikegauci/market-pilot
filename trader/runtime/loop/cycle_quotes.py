from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from broker.manual_close import process_manual_close_commands
from broker.manual_entry import process_manual_entry_commands
from broker.position_cover import process_position_cover_commands
from broker.ibkr import MARKET_DATA_COMPETING_SESSION_MSG
from config import Settings
from database.supabase import SupabaseRepository
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from models.types import DataSource, ExecutionMode
from risk.manager import RiskManager
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.state import TraderRuntimeState
from runtime.trader_ops import get_quotes

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from market.mock import MockMarketProvider

logger = logging.getLogger(__name__)

MARKET_DATA_WARN_INTERVAL_SEC = 300.0


def run_cycle_quotes_and_commands(
    *,
    settings: Settings,
    db: SupabaseRepository | None,
    ibkr: "IBKRClient",
    mock: "MockMarketProvider",
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    risk_manager: RiskManager | None,
    scratch: EvalCycleScratch,
    runtime: TraderRuntimeState,
) -> None:
    scratch.daily_pnl_account_id = (
        scratch.active_ibkr_account_id
        if scratch.execution_mode == ExecutionMode.IBKR
        else None
    )

    scratch.quotes = get_quotes(settings, ibkr, mock, scratch.all_symbols)
    scratch.quotes_by_symbol = {q.symbol: q for q in scratch.quotes}

    if (
        settings.data_source == DataSource.IBKR
        and ibkr.is_connected()
        and runtime.ibkr_market_data_mode == "unavailable"
    ):
        now_mono = time.monotonic()
        if (now_mono - runtime.last_market_data_warn) >= MARKET_DATA_WARN_INTERVAL_SEC:
            priced = sum(
                1
                for quote in scratch.quotes
                if quote.price is not None and quote.price > 0
            )
            logger.warning(
                "IBKR quotes still missing (%s/%s symbols priced) — %s",
                priced,
                len(scratch.quotes),
                MARKET_DATA_COMPETING_SESSION_MSG,
            )
            runtime.last_market_data_warn = now_mono
            recovered = ibkr.ensure_market_data_ready(scratch.all_symbols, wait_sec=1.0)
            if recovered != "unavailable":
                runtime.ibkr_market_data_mode = recovered
                logger.info("IBKR market data mode restored: %s", recovered)
                scratch.quotes = get_quotes(settings, ibkr, mock, scratch.all_symbols)
                scratch.quotes_by_symbol = {q.symbol: q for q in scratch.quotes}

    if db:
        if process_position_cover_commands(
            db,
            ibkr,
            scratch.execution_mode,
            scratch.quotes_by_symbol,
            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
        ):
            scratch.portfolio_dirty = True

    if risk_manager and db:
        if process_manual_entry_commands(
            db,
            risk_manager,
            ibkr,
            scratch.execution_mode,
            scratch.quotes_by_symbol,
            minute_bars,
            bar_store,
            scratch.strategy_config,
            settings,
            runtime,
            bot_enabled=scratch.bot_enabled,
            active_ibkr_account_id=scratch.active_ibkr_account_id,
            benchmark_minute_bars=scratch.benchmark_minute_bars,
            benchmark_intraday_bars=scratch.benchmark_intraday_bars,
            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
        ):
            scratch.portfolio_dirty = True

        if process_manual_close_commands(
            db,
            risk_manager,
            ibkr,
            scratch.execution_mode,
            scratch.quotes_by_symbol,
            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
            ibkr_account_id=scratch.daily_pnl_account_id,
        ):
            scratch.portfolio_dirty = True

    for quote in scratch.quotes:
        minute_bars.record(quote)
