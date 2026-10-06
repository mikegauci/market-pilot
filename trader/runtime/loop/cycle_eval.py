from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, List, Tuple

from broker.execution import close_ibkr_signal_exits, collect_profit_take_trade_ids
from config import Settings
from database.prediction_payload import build_filter_skip_payload
from database.supabase import SupabaseRepository
from jev.client import JevClient
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_us_regular_session_open
from market.indicators import MarketState, build_market_state
from models.types import DataSource, ExecutionMode
from news.enrich import enrich_market_state_with_news
from news.client import NewsService
from risk.manager import RiskManager
from runtime.entry_eval import process_ready_states
from runtime.eval_symbols import build_eval_symbols, eval_allow_five_min_fallback
from runtime.jev_fetch import fetch_jev_predictions
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.sim_close import persist_simulated_closes
from runtime.state import TraderRuntimeState
from runtime.trader_ops import sync_portfolio_state
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from strategy.filters import check_entry_filters
from strategy.profit_take_tracker import ProfitTakeBandTracker
from watchlist.resolution import effective_benchmark

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient

logger = logging.getLogger(__name__)

CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0


def run_cycle_market_gate(
    *,
    settings: Settings,
    db: SupabaseRepository | None,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    risk_manager: RiskManager | None,
    scratch: EvalCycleScratch,
    runtime: TraderRuntimeState,
) -> None:
    scratch.benchmark_symbol = (
        effective_benchmark(scratch.risk_settings) if db and scratch.risk_settings else ""
    )
    benchmark_key = scratch.benchmark_symbol.upper() if scratch.benchmark_symbol else ""
    scratch.benchmark_minute_bars = (
        minute_bars.get(benchmark_key) if benchmark_key else None
    )
    scratch.benchmark_intraday_bars = (
        bar_store.get_intraday_bars(benchmark_key)
        if bar_store and benchmark_key
        else None
    )
    scratch.market_open = (
        settings.data_source != DataSource.IBKR or is_us_regular_session_open()
    )
    if not scratch.market_open:
        now_mono = time.monotonic()
        if (now_mono - runtime.last_closed_market_log) >= CLOSED_MARKET_LOG_INTERVAL_SEC:
            logger.info("US market closed — skipping Jev (exits/heartbeat continue)")
            runtime.last_closed_market_log = now_mono

    scratch.eval_symbols = []
    if scratch.market_open:
        open_symbols = (
            [t.symbol for t in risk_manager.open_trades] if risk_manager else []
        )
        scratch.open_symbols = open_symbols
        scratch.eval_symbols = build_eval_symbols(
            scratch.watchlist, open_symbols, scratch.risk_settings
        )

    scratch.open_symbol_set = (
        {s.upper() for s in scratch.open_symbols} if scratch.market_open else set()
    )


def run_cycle_eval_and_exits_after_jev(
    *,
    settings: Settings,
    db: SupabaseRepository | None,
    ibkr: "IBKRClient",
    jev: JevClient | None,
    news_service: NewsService | None,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    risk_manager: RiskManager | None,
    confirmation_tracker: ConfirmationTracker,
    profit_take_tracker: ProfitTakeBandTracker,
    scratch: EvalCycleScratch,
    strategy_config: StrategyConfig,
    runtime: TraderRuntimeState,
    data_source_label: str,
    active_ibkr_account_id: str | None,
) -> None:
    if news_service and scratch.eval_symbols:
        news_service.refresh_stale(scratch.eval_symbols)

    ready_states: List[Tuple[str, MarketState]] = []
    for symbol in scratch.eval_symbols:
        quote = scratch.quotes_by_symbol.get(symbol)
        if quote is None:
            continue

        sym_upper = symbol.upper()
        is_open_position = sym_upper in scratch.open_symbol_set
        symbol_intraday = bar_store.get_intraday_bars(sym_upper)
        state = build_market_state(
            quote,
            minute_bars.get(symbol),
            scratch.benchmark_minute_bars,
            trend_changes=bar_store.get_trend_changes(symbol),
            warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
            min_live_1m_bars=(
                strategy_config.min_live_1m_bars_open
                if is_open_position
                else strategy_config.warmup_min_1m_bars
            ),
            allow_five_min_fallback=eval_allow_five_min_fallback(
                is_open_position,
                symbol_intraday,
                strategy_config.warmup_min_1m_bars,
            ),
            symbol_intraday_bars=symbol_intraday,
            benchmark_intraday_bars=scratch.benchmark_intraday_bars,
        )
        if state is None:
            if symbol not in runtime.warmup_logged:
                logger.debug(
                    "%s warming up — need %s one-minute bars",
                    symbol,
                    strategy_config.warmup_min_1m_bars,
                )
                runtime.warmup_logged.add(symbol)
            continue

        logger.info(
            "%s  $%.2f  (%s)",
            symbol,
            state.price,
            data_source_label,
        )

        state = enrich_market_state_with_news(state, news_service)
        if not is_open_position:
            entry_filter = check_entry_filters(state, strategy_config)
            if not entry_filter.passed:
                logger.info(
                    "Filter: skipped Jev for %s — %s",
                    symbol,
                    entry_filter.reason,
                )
                scratch.prediction_rows.append(
                    build_filter_skip_payload(state, entry_filter.reason)
                )
                continue

        if jev is None:
            continue

        ready_states.append((symbol, state))

    scratch.ready_states = ready_states
    if jev is not None and ready_states:
        scratch.predictions_by_symbol = fetch_jev_predictions(
            jev, ready_states, settings.jev_max_workers
        )
    if scratch.predictions_by_symbol:
        scratch.jev_connected_this_cycle = True
        scratch.jev_connected = True
    elif ready_states and jev is not None:
        scratch.jev_connected = False

    eval_outcome = process_ready_states(
        ready_states=ready_states,
        predictions_by_symbol=scratch.predictions_by_symbol,
        db=db,
        risk_manager=risk_manager,
        risk_settings=scratch.risk_settings,
        strategy_config=strategy_config,
        runtime_entry_strategy=strategy_config,
        bar_store=bar_store,
        quotes_by_symbol=scratch.quotes_by_symbol,
        confirmation_tracker=confirmation_tracker,
        bot_enabled=scratch.bot_enabled,
        execution_mode=scratch.execution_mode,
        ibkr=ibkr,
        settings=settings,
        active_ibkr_account_id=active_ibkr_account_id,
        daily_pnl_account_id=scratch.daily_pnl_account_id,
        runtime=runtime,
    )
    scratch.prediction_rows = scratch.prediction_rows + eval_outcome.prediction_rows
    if eval_outcome.portfolio_dirty:
        scratch.portfolio_dirty = True
    scratch.jev_sell_symbols.update(eval_outcome.jev_sell_symbols)

    if db and scratch.prediction_rows:
        db.insert_predictions_batch(scratch.prediction_rows)
        logger.info("Stored %s prediction(s)", len(scratch.prediction_rows))

    if risk_manager and db:
        closed_profit_take_sim = risk_manager.check_profit_take_exits(
            scratch.quotes_by_symbol,
            profit_take_tracker,
            scratch.predictions_by_symbol,
        )
        if persist_simulated_closes(
            db,
            risk_manager,
            closed_profit_take_sim,
            daily_pnl_account_id=scratch.daily_pnl_account_id,
        ):
            scratch.portfolio_dirty = True

    if (
        risk_manager
        and db
        and scratch.execution_mode == ExecutionMode.IBKR
        and ibkr.is_connected()
    ):
        profit_take_trade_ids = collect_profit_take_trade_ids(
            risk_manager.open_trades,
            scratch.quotes_by_symbol,
            scratch.risk_settings,
            profit_take_tracker,
            scratch.predictions_by_symbol,
        )
        closed_signals, closed_trade_ids = close_ibkr_signal_exits(
            ibkr,
            risk_manager,
            db,
            max_hold_minutes=0,
            max_hold_for_symbol=lambda sym: float(scratch.risk_settings.max_hold_minutes),
            jev_sell_symbols=scratch.jev_sell_symbols,
            profit_take_trade_ids=profit_take_trade_ids,
            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
            ibkr_account_id=scratch.daily_pnl_account_id,
        )
        if closed_signals:
            scratch.portfolio_dirty = True
            for trade_id in closed_trade_ids:
                profit_take_tracker.clear(trade_id)

    if scratch.portfolio_dirty and db:
        sync_portfolio_state(
            db,
            ibkr,
            risk_manager,
            scratch.execution_mode,
            scratch.quotes,
            scratch.trading_mode,
        )
        scratch.portfolio_dirty = False
