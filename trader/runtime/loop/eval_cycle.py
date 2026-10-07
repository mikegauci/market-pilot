from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, List, Optional

from broker.ibkr import IBKRClient
from config import Settings
from database.supabase import SupabaseRepository
from jev.client import JevClient
from jev.shadow_read import OpenAiShadowReader
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.mock import MockMarketProvider
from models.types import ExecutionMode, RiskSettings, TradingMode
from news.client import FinnhubNewsClient, NewsService
from risk.manager import RiskManager
from runtime.loop.cycle_eval import (
    run_cycle_eval_and_exits_after_jev,
    run_cycle_market_gate,
)
from runtime.loop.cycle_exits import run_cycle_exits
from runtime.loop.cycle_quotes import run_cycle_quotes_and_commands
from runtime.loop.cycle_rotation import run_cycle_rotation_and_bar_flush
from runtime.loop.cycle_sync import run_cycle_sync
from runtime.loop.cycle_tail import finish_eval_cycle_sleep, run_cycle_heartbeat_and_status
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from strategy.profit_take_tracker import ProfitTakeBandTracker

logger = logging.getLogger(__name__)


@dataclass
class EvalCycleContext:
    runtime: TraderRuntimeState
    settings: Settings
    db: SupabaseRepository
    mock: MockMarketProvider
    minute_bars: MinuteBarStore
    bar_store: BarStore
    ibkr: IBKRClient
    jev: Optional[JevClient]
    news_service: Optional[NewsService]
    risk_manager: Optional[RiskManager]
    confirmation_tracker: ConfirmationTracker
    profit_take_tracker: ProfitTakeBandTracker
    loss_cut_tracker: ProfitTakeBandTracker
    bot_enabled: bool
    trading_mode: TradingMode
    configured_execution_mode: ExecutionMode
    execution_mode: ExecutionMode
    last_bot_control_sync: float
    last_settings_sync: float
    last_heartbeat: float
    last_portfolio_history: float
    last_live_bar_flush: float
    active_ibkr_account_id: Optional[str]
    jev_connected: bool
    risk_settings: RiskSettings
    strategy_config: StrategyConfig
    watchlist: List[str]
    all_symbols: List[str]
    data_source_label: str
    news_client: Optional[FinnhubNewsClient] = None
    last_general_news_refresh: float = 0.0
    shadow_reader: Optional[OpenAiShadowReader] = None


def run_eval_cycle(
    ctx: EvalCycleContext,
    *,
    start_general_news_refresh: Callable[[], None],
) -> None:
    """One iteration of the main trading loop (settings sync through sleep)."""
    runtime = ctx.runtime
    settings = ctx.settings
    db = ctx.db
    scratch = EvalCycleScratch.from_context(ctx)
    loop_start = time.monotonic()

    try:
        if db:
            run_cycle_sync(
                db=db,
                settings=settings,
                runtime=runtime,
                mock=ctx.mock,
                minute_bars=ctx.minute_bars,
                bar_store=ctx.bar_store,
                ibkr=ctx.ibkr,
                risk_manager=ctx.risk_manager,
                confirmation_tracker=ctx.confirmation_tracker,
                profit_take_tracker=ctx.profit_take_tracker,
                loss_cut_tracker=ctx.loss_cut_tracker,
                scratch=scratch,
                news_client=ctx.news_client,
                last_general_news_refresh=ctx.last_general_news_refresh,
                start_general_news_refresh=start_general_news_refresh,
            )

        run_cycle_quotes_and_commands(
            settings=settings,
            db=db,
            ibkr=ctx.ibkr,
            mock=ctx.mock,
            minute_bars=ctx.minute_bars,
            bar_store=ctx.bar_store,
            risk_manager=ctx.risk_manager,
            scratch=scratch,
            runtime=runtime,
        )

        run_cycle_rotation_and_bar_flush(
            db=db,
            settings=settings,
            mock=ctx.mock,
            minute_bars=ctx.minute_bars,
            bar_store=ctx.bar_store,
            ibkr=ctx.ibkr,
            risk_manager=ctx.risk_manager,
            confirmation_tracker=ctx.confirmation_tracker,
            strategy_config=scratch.strategy_config,
            scratch=scratch,
            runtime=runtime,
        )

        run_cycle_exits(
            db=db,
            settings=settings,
            ibkr=ctx.ibkr,
            risk_manager=ctx.risk_manager,
            scratch=scratch,
            strategy_config=scratch.strategy_config,
            runtime=runtime,
        )

        run_cycle_market_gate(
            settings=settings,
            db=db,
            minute_bars=ctx.minute_bars,
            bar_store=ctx.bar_store,
            risk_manager=ctx.risk_manager,
            scratch=scratch,
            runtime=runtime,
        )

        run_cycle_eval_and_exits_after_jev(
            settings=settings,
            db=db,
            ibkr=ctx.ibkr,
            jev=ctx.jev,
            news_service=ctx.news_service,
            minute_bars=ctx.minute_bars,
            bar_store=ctx.bar_store,
            risk_manager=ctx.risk_manager,
            confirmation_tracker=ctx.confirmation_tracker,
            profit_take_tracker=ctx.profit_take_tracker,
            loss_cut_tracker=ctx.loss_cut_tracker,
            scratch=scratch,
            strategy_config=scratch.strategy_config,
            runtime=runtime,
            data_source_label=ctx.data_source_label,
            active_ibkr_account_id=scratch.active_ibkr_account_id,
            shadow_reader=ctx.shadow_reader,
        )

        run_cycle_heartbeat_and_status(
            db=db,
            settings=settings,
            ibkr=ctx.ibkr,
            risk_manager=ctx.risk_manager,
            scratch=scratch,
            runtime=runtime,
            data_source_label=ctx.data_source_label,
        )

    except Exception as exc:
        logger.exception("Eval cycle failed: %s", exc)
        if db:
            db.record_error(
                str(exc),
                enabled=scratch.bot_enabled,
                trading_mode=scratch.trading_mode,
                execution_mode=scratch.configured_execution_mode,
            )

    finish_eval_cycle_sleep(
        ctx=ctx,
        scratch=scratch,
        settings=settings,
        runtime=runtime,
        loop_start=loop_start,
    )
