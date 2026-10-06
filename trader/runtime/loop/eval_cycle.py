from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Set, Tuple

from broker.execution import (
    EOD_RETRY_SEC,
    close_ibkr_signal_exits,
    collect_profit_take_trade_ids,
    force_eod_ibkr_exits,
    reconcile_flat_ibkr_trades,
    sync_ibkr_exits,
)
from broker.ibkr import IBKRClient, MARKET_DATA_COMPETING_SESSION_MSG
from broker.manual_close import process_manual_close_commands
from broker.position_cover import process_position_cover_commands
from broker.reconcile import refresh_ibkr_bracket_targets
from config import Settings
from database.prediction_payload import build_filter_skip_payload
from database.supabase import SupabaseRepository
from execution_mode import effective_execution_mode
from jev.client import JevClient
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_us_regular_session_open, should_force_eod_flatten
from market.indicators import build_market_state
from market.mock import MockMarketProvider
from models.types import DataSource, ExecutionMode, JevPrediction, Quote, RiskSettings, TradingMode
from news.enrich import enrich_market_state_with_news
from news.client import FinnhubNewsClient, NewsService
from risk.manager import RiskManager
from runtime.entry_eval import process_ready_states
from runtime.eval_symbols import build_eval_symbols, eval_allow_five_min_fallback
from runtime.heartbeat import run_heartbeat_cycle
from runtime.jev_fetch import fetch_jev_predictions
from runtime.sim_close import persist_simulated_closes
from runtime.state import TraderRuntimeState
from runtime.status_log import log_trader_running
from runtime.timing import compute_loop_sleep_sec, should_refresh
from runtime.trader_ops import (
    get_quotes,
    interruptible_sleep,
    merge_watchlist_symbols,
    sync_portfolio_state,
    sync_watchlist_symbols,
)
from strategy.config import StrategyConfig, strategy_config_with_risk_overrides
from strategy.confirmation import ConfirmationTracker
from strategy.filters import check_entry_filters
from strategy.profit_take_tracker import ProfitTakeBandTracker
from runtime.capital import sync_risk_manager_capital
from watchlist.backfill import backfill_watchlist_symbols
from watchlist.resolution import effective_benchmark, resolve_runtime_watchlist, strip_benchmark_symbol
from watchlist.rotation_runtime import maybe_rotate_watchlist

logger = logging.getLogger(__name__)

CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0
MARKET_DATA_WARN_INTERVAL_SEC = 300.0


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


def run_eval_cycle(
    ctx: EvalCycleContext,
    *,
    start_general_news_refresh: Callable[[], None],
) -> None:
    """One iteration of the main trading loop (settings sync through sleep)."""
    runtime = ctx.runtime
    settings = ctx.settings
    db = ctx.db
    mock = ctx.mock
    minute_bars = ctx.minute_bars
    bar_store = ctx.bar_store
    ibkr = ctx.ibkr
    jev = ctx.jev
    news_service = ctx.news_service
    risk_manager = ctx.risk_manager
    confirmation_tracker = ctx.confirmation_tracker
    profit_take_tracker = ctx.profit_take_tracker
    bot_enabled = ctx.bot_enabled
    trading_mode = ctx.trading_mode
    configured_execution_mode = ctx.configured_execution_mode
    execution_mode = ctx.execution_mode
    last_bot_control_sync = ctx.last_bot_control_sync
    last_settings_sync = ctx.last_settings_sync
    last_heartbeat = ctx.last_heartbeat
    last_portfolio_history = ctx.last_portfolio_history
    last_live_bar_flush = ctx.last_live_bar_flush
    active_ibkr_account_id = ctx.active_ibkr_account_id
    jev_connected = ctx.jev_connected
    risk_settings = ctx.risk_settings
    strategy_config = ctx.strategy_config
    watchlist = ctx.watchlist
    all_symbols = ctx.all_symbols
    data_source_label = ctx.data_source_label
    news_client = ctx.news_client
    loop_start = time.monotonic()
    jev_connected_this_cycle = False
    market_open = True
    portfolio_dirty = False

    try:
        if db:
            if db.poll_shutdown_requested():
                logger.info(
                    "Shutdown requested from dashboard — stopping trading engine"
                )
                runtime.shutdown_requested = True

            now_mono = time.monotonic()
            if should_refresh(
                now_mono,
                last_bot_control_sync,
                settings.bot_control_refresh_interval_sec,
            ):
                bot_control = db.get_bot_control(settings.execution_mode)
                bot_enabled = bot_control.enabled
                trading_mode = bot_control.trading_mode
                configured_execution_mode = bot_control.execution_mode
                execution_mode = effective_execution_mode(
                    settings.data_source, configured_execution_mode
                )
                last_bot_control_sync = now_mono

            if (
                news_client is not None
                and should_refresh(
                    now_mono,
                    ctx.last_general_news_refresh,
                    settings.news_general_refresh_sec,
                )
            ):
                start_general_news_refresh()

            if should_refresh(
                now_mono,
                last_settings_sync,
                settings.settings_refresh_interval_sec,
            ):
                risk_settings = db.get_risk_settings()
                prev_cycles = strategy_config.confirmation_cycles
                prev_seconds = strategy_config.confirmation_seconds
                strategy_config = strategy_config_with_risk_overrides(
                    settings.strategy_config,
                    min_volume_ratio=risk_settings.min_volume_ratio,
                    min_share_price=risk_settings.min_share_price,
                    min_dollar_volume=risk_settings.min_dollar_volume,
                    jev_sell_exit_threshold=risk_settings.jev_sell_exit_threshold,
                    confirmation_cycles=risk_settings.confirmation_cycles,
                    confirmation_seconds=risk_settings.confirmation_seconds,
                )
                if (
                    strategy_config.confirmation_cycles != prev_cycles
                    or strategy_config.confirmation_seconds != prev_seconds
                ):
                    confirmation_tracker.reconfigure(
                        strategy_config.confirmation_cycles,
                        strategy_config.confirmation_seconds,
                    )
                profit_take_tracker.reconfigure(
                    risk_settings.profit_take_band_window_cycles,
                )
                last_settings_sync = now_mono

            benchmark_symbol = effective_benchmark(risk_settings)
            open_symbols = (
                [t.symbol for t in risk_manager.open_trades]
                if risk_manager
                else []
            )
            manual_watchlist = resolve_runtime_watchlist(
                risk_settings,
                open_symbols,
                env_fallback=settings.watchlist_symbols,
            )
            if (
                risk_settings.watchlist_rotation_enabled
                and risk_settings.watchlist_pool
            ):
                watchlist = strip_benchmark_symbol(
                    risk_settings.watchlist_active or risk_settings.watchlist_pool,
                    risk_settings,
                )
                quote_symbols = list(
                    dict.fromkeys(
                        list(risk_settings.watchlist_pool)
                        + watchlist
                        + open_symbols
                    )
                )
            else:
                watchlist = manual_watchlist
                quote_symbols = list(dict.fromkeys(watchlist + open_symbols))
            all_symbols = merge_watchlist_symbols(quote_symbols, benchmark_symbol)
            new_watchlist_symbols = sync_watchlist_symbols(
                all_symbols,
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
            if (
                settings.data_source == DataSource.IBKR
                and ibkr.is_connected()
            ):
                ibkr.sync_watchlist_subscriptions(all_symbols)
            if risk_manager:
                risk_manager.update_settings(risk_settings)
                sync_risk_manager_capital(
                    risk_manager,
                    ibkr,
                    risk_settings.account_capital,
                )

        daily_pnl_account_id = (
            active_ibkr_account_id
            if execution_mode == ExecutionMode.IBKR
            else None
        )

        quotes = get_quotes(settings, ibkr, mock, all_symbols)
        quotes_by_symbol: Dict[str, Quote] = {q.symbol: q for q in quotes}

        if (
            settings.data_source == DataSource.IBKR
            and ibkr.is_connected()
            and runtime.ibkr_market_data_mode == "unavailable"
        ):
            now_mono = time.monotonic()
            if (now_mono - runtime.last_market_data_warn) >= MARKET_DATA_WARN_INTERVAL_SEC:
                priced = sum(
                    1 for quote in quotes if quote.price is not None and quote.price > 0
                )
                logger.warning(
                    "IBKR quotes still missing (%s/%s symbols priced) — %s",
                    priced,
                    len(quotes),
                    MARKET_DATA_COMPETING_SESSION_MSG,
                )
                runtime.last_market_data_warn = now_mono
                recovered = ibkr.ensure_market_data_ready(all_symbols, wait_sec=1.0)
                if recovered != "unavailable":
                    runtime.ibkr_market_data_mode = recovered
                    logger.info("IBKR market data mode restored: %s", recovered)
                    quotes = get_quotes(settings, ibkr, mock, all_symbols)
                    quotes_by_symbol = {q.symbol: q for q in quotes}

        if db:
            if process_position_cover_commands(
                db,
                ibkr,
                execution_mode,
                quotes_by_symbol,
                fill_timeout_sec=settings.ibkr_fill_timeout_sec,
            ):
                portfolio_dirty = True

        if risk_manager and db:
            if process_manual_close_commands(
                db,
                risk_manager,
                ibkr,
                execution_mode,
                quotes_by_symbol,
                fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                ibkr_account_id=daily_pnl_account_id,
            ):
                portfolio_dirty = True

        for quote in quotes:
            minute_bars.record(quote)

        if (
            db
            and risk_settings.watchlist_rotation_enabled
            and risk_settings.watchlist_pool
        ):
            benchmark_agg = (
                minute_bars.get(benchmark_symbol) if benchmark_symbol else None
            )
            risk_settings, rotation_swapped_in = maybe_rotate_watchlist(
                db=db,
                risk_settings=risk_settings,
                minute_bars=minute_bars,
                bar_store=bar_store,
                quotes_by_symbol=quotes_by_symbol,
                benchmark_minute_bars=benchmark_agg,
                confirmation_tracker=confirmation_tracker,
                open_symbols=open_symbols,
                runtime=runtime,
                now_mono=time.monotonic(),
                market_open=market_open
                if settings.data_source != DataSource.IBKR
                else is_us_regular_session_open(),
                strategy_config=strategy_config,
            )
            watchlist = strip_benchmark_symbol(
                risk_settings.watchlist_active or risk_settings.watchlist_pool,
                risk_settings,
            )
            if rotation_swapped_in:
                rot_open = (
                    [t.symbol for t in risk_manager.open_trades]
                    if risk_manager
                    else []
                )
                rot_benchmark = effective_benchmark(risk_settings)
                rot_quote_symbols = list(
                    dict.fromkeys(
                        list(risk_settings.watchlist_pool)
                        + watchlist
                        + rot_open
                    )
                )
                rot_all_symbols = merge_watchlist_symbols(
                    rot_quote_symbols, rot_benchmark
                )
                new_rot_symbols = sync_watchlist_symbols(
                    rot_all_symbols,
                    mock,
                    minute_bars,
                    bar_store,
                    settings.data_source,
                    runtime,
                )
                if (
                    settings.data_source == DataSource.IBKR
                    and ibkr.is_connected()
                ):
                    ibkr.sync_watchlist_subscriptions(rot_all_symbols)
                    if new_rot_symbols:
                        backfill_watchlist_symbols(
                            settings,
                            bar_store,
                            ibkr,
                            new_rot_symbols,
                            open_symbols=rot_open,
                        )

        now_mono = time.monotonic()
        if (
            risk_manager
            and (
                settings.data_source == DataSource.MOCK
                or is_us_regular_session_open()
            )
            and should_refresh(
                now_mono,
                last_live_bar_flush,
                settings.live_bar_flush_interval_sec,
            )
        ):
            open_syms = list(
                dict.fromkeys(trade.symbol for trade in risk_manager.open_trades)
            )
            if open_syms:
                flushed = bar_store.flush_live_intraday_bars(open_syms, minute_bars)
                if flushed:
                    logger.debug(
                        "Flushed live 5m bars for %s open position(s)",
                        flushed,
                    )
            last_live_bar_flush = now_mono

        if risk_manager and db:
            max_hold = float(risk_settings.max_hold_minutes)

            def _max_hold_for_symbol(symbol: str) -> float:
                return max_hold

            closed = risk_manager.check_exits(
                quotes_by_symbol,
                max_hold_for_symbol=_max_hold_for_symbol,
            )
            if persist_simulated_closes(
                db,
                risk_manager,
                closed,
                daily_pnl_account_id=daily_pnl_account_id,
            ):
                portfolio_dirty = True

            if is_us_regular_session_open() and should_force_eod_flatten(
                flatten_minutes_before_close=strategy_config.eod_flatten_minutes_before_close
            ):
                eod_closed: list = []
                now_eod_mono = time.monotonic()
                if (
                    now_eod_mono - runtime.eod_sim_last_attempt_mono
                ) >= EOD_RETRY_SEC:
                    runtime.eod_sim_last_attempt_mono = now_eod_mono
                    eod_closed = risk_manager.force_close_all_simulated(
                        quotes_by_symbol,
                        reason="eod_flatten",
                    )
                if persist_simulated_closes(
                    db,
                    risk_manager,
                    eod_closed,
                    daily_pnl_account_id=daily_pnl_account_id,
                ):
                    portfolio_dirty = True
                if (
                    execution_mode == ExecutionMode.IBKR
                    and ibkr.is_connected()
                    and force_eod_ibkr_exits(
                        ibkr,
                        risk_manager,
                        db,
                        fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                        ibkr_account_id=daily_pnl_account_id,
                        eod_last_attempt_mono=runtime.eod_ibkr_last_attempt_mono,
                    )
                ):
                    portfolio_dirty = True

            if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                if sync_ibkr_exits(
                    ibkr,
                    risk_manager,
                    db,
                    ibkr_account_id=daily_pnl_account_id,
                ):
                    portfolio_dirty = True
                if reconcile_flat_ibkr_trades(
                    ibkr,
                    risk_manager,
                    db,
                    quotes_by_symbol,
                    ibkr_account_id=daily_pnl_account_id,
                ):
                    portfolio_dirty = True
                refresh_ibkr_bracket_targets(ibkr, risk_manager, db)

        if portfolio_dirty and db:
            sync_portfolio_state(
                db, ibkr, risk_manager, execution_mode, quotes
            )
            portfolio_dirty = False

        benchmark_symbol = (
            effective_benchmark(risk_settings) if db and risk_settings else ""
        )
        benchmark_key = benchmark_symbol.upper() if benchmark_symbol else ""
        benchmark_minute_bars = (
            minute_bars.get(benchmark_key) if benchmark_key else None
        )
        benchmark_intraday_bars = (
            bar_store.get_intraday_bars(benchmark_key)
            if bar_store and benchmark_key
            else None
        )
        market_open = (
            settings.data_source != DataSource.IBKR or is_us_regular_session_open()
        )
        if not market_open:
            now_mono = time.monotonic()
            if (
                now_mono - runtime.last_closed_market_log
            ) >= CLOSED_MARKET_LOG_INTERVAL_SEC:
                logger.info(
                    "US market closed — skipping Jev (exits/heartbeat continue)"
                )
                runtime.last_closed_market_log = now_mono

        eval_symbols: list[str] = []
        if market_open:
            open_symbols = (
                [t.symbol for t in risk_manager.open_trades]
                if risk_manager
                else []
            )
            # Benchmark is never an entry candidate; open positions stay for exits.
            eval_symbols = build_eval_symbols(
                watchlist, open_symbols, risk_settings
            )

        open_symbol_set = {s.upper() for s in open_symbols} if market_open else set()

        jev_sell_symbols: Set[str] = set()
        prediction_rows: List[dict] = []
        predictions_by_symbol: Dict[str, JevPrediction] = {}

        if news_service and eval_symbols:
            news_service.refresh_stale(eval_symbols)

        ready_states: List[Tuple[str, MarketState]] = []
        for symbol in eval_symbols:
            quote = quotes_by_symbol.get(symbol)
            if quote is None:
                continue

            sym_upper = symbol.upper()
            is_open_position = sym_upper in open_symbol_set
            symbol_intraday = bar_store.get_intraday_bars(sym_upper)
            state = build_market_state(
                quote,
                minute_bars.get(symbol),
                benchmark_minute_bars,
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
                benchmark_intraday_bars=benchmark_intraday_bars,
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
                    prediction_rows.append(
                        build_filter_skip_payload(state, entry_filter.reason)
                    )
                    continue

            if jev is None:
                continue

            ready_states.append((symbol, state))

        if jev is not None and ready_states:
            predictions_by_symbol = fetch_jev_predictions(
                jev, ready_states, settings.jev_max_workers
            )
        if predictions_by_symbol:
            jev_connected_this_cycle = True
            jev_connected = True
        elif ready_states and jev is not None:
            jev_connected = False

        eval_outcome = process_ready_states(
            ready_states=ready_states,
            predictions_by_symbol=predictions_by_symbol,
            db=db,
            risk_manager=risk_manager,
            risk_settings=risk_settings,
            strategy_config=strategy_config,
            runtime_entry_strategy=strategy_config,
            bar_store=bar_store,
            quotes_by_symbol=quotes_by_symbol,
            confirmation_tracker=confirmation_tracker,
            bot_enabled=bot_enabled,
            execution_mode=execution_mode,
            ibkr=ibkr,
            settings=settings,
            active_ibkr_account_id=active_ibkr_account_id,
            daily_pnl_account_id=daily_pnl_account_id,
            runtime=runtime,
        )
        prediction_rows = prediction_rows + eval_outcome.prediction_rows
        if eval_outcome.portfolio_dirty:
            portfolio_dirty = True
        jev_sell_symbols.update(eval_outcome.jev_sell_symbols)

        if db and prediction_rows:
            db.insert_predictions_batch(prediction_rows)
            logger.info("Stored %s prediction(s)", len(prediction_rows))

        if risk_manager and db:
            closed_profit_take_sim = risk_manager.check_profit_take_exits(
                quotes_by_symbol,
                profit_take_tracker,
                predictions_by_symbol,
            )
            if persist_simulated_closes(
                db,
                risk_manager,
                closed_profit_take_sim,
                daily_pnl_account_id=daily_pnl_account_id,
            ):
                portfolio_dirty = True

        if (
            risk_manager
            and db
            and execution_mode == ExecutionMode.IBKR
            and ibkr.is_connected()
        ):
            profit_take_trade_ids = collect_profit_take_trade_ids(
                risk_manager.open_trades,
                quotes_by_symbol,
                risk_settings,
                profit_take_tracker,
                predictions_by_symbol,
            )
            closed_signals, closed_trade_ids = close_ibkr_signal_exits(
                ibkr,
                risk_manager,
                db,
                max_hold_minutes=0,
                max_hold_for_symbol=lambda sym: float(risk_settings.max_hold_minutes),
                jev_sell_symbols=jev_sell_symbols,
                profit_take_trade_ids=profit_take_trade_ids,
                fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                ibkr_account_id=daily_pnl_account_id,
            )
            if closed_signals:
                portfolio_dirty = True
                for trade_id in closed_trade_ids:
                    profit_take_tracker.clear(trade_id)

        if portfolio_dirty and db:
            sync_portfolio_state(
                db, ibkr, risk_manager, execution_mode, quotes
            )
            portfolio_dirty = False

        now = time.monotonic()
        if db:
            last_heartbeat, last_portfolio_history, active_ibkr_account_id = (
                run_heartbeat_cycle(
                    db=db,
                    settings=settings,
                    ibkr=ibkr,
                    risk_manager=risk_manager,
                    risk_settings=risk_settings,
                    quotes=quotes,
                    quotes_by_symbol=quotes_by_symbol,
                    bot_enabled=bot_enabled,
                    trading_mode=trading_mode,
                    configured_execution_mode=configured_execution_mode,
                    execution_mode=execution_mode,
                    jev_connected_this_cycle=jev_connected_this_cycle,
                    jev_connected=jev_connected,
                    active_ibkr_account_id=active_ibkr_account_id,
                    last_heartbeat=last_heartbeat,
                    last_portfolio_history=last_portfolio_history,
                    now_mono=now,
                )
            )

        if should_refresh(
            now,
            runtime.last_trader_status_log_mono,
            CLOSED_MARKET_LOG_INTERVAL_SEC,
        ):
            runtime.last_trader_status_log_mono = now
            log_trader_running(
                bot_enabled=bot_enabled,
                market_open=market_open,
                ibkr_connected=ibkr.is_connected(),
                jev_connected=jev_connected_this_cycle or jev_connected,
                execution_mode=execution_mode,
                open_trades=len(risk_manager.open_trades) if risk_manager else 0,
                ibkr_account_id=active_ibkr_account_id,
                data_source=data_source_label,
            )

    except Exception as exc:
        logger.exception("Eval cycle failed: %s", exc)
        if db:
            db.record_error(
                str(exc),
                enabled=bot_enabled,
                trading_mode=trading_mode,
                execution_mode=configured_execution_mode,
            )

    elapsed = time.monotonic() - loop_start
    if market_open:
        runtime.cycle_elapsed_sec.append(elapsed)
        if len(runtime.cycle_elapsed_sec) > 30:
            runtime.cycle_elapsed_sec = runtime.cycle_elapsed_sec[-30:]
    interval = (
        settings.eval_interval_sec
        if market_open
        else settings.closed_market_eval_interval_sec
    )
    sleep_for = compute_loop_sleep_sec(
        interval,
        elapsed,
        last_heartbeat,
        time.monotonic(),
        settings.heartbeat_interval_sec,
        track_heartbeat=db is not None,
    )
    ctx.bot_enabled = bot_enabled
    ctx.trading_mode = trading_mode
    ctx.configured_execution_mode = configured_execution_mode
    ctx.execution_mode = execution_mode
    ctx.last_bot_control_sync = last_bot_control_sync
    ctx.last_settings_sync = last_settings_sync
    ctx.last_heartbeat = last_heartbeat
    ctx.last_portfolio_history = last_portfolio_history
    ctx.last_live_bar_flush = last_live_bar_flush
    ctx.active_ibkr_account_id = active_ibkr_account_id
    ctx.jev_connected = jev_connected
    ctx.risk_settings = risk_settings
    ctx.strategy_config = strategy_config
    ctx.watchlist = watchlist
    ctx.all_symbols = all_symbols
    if sleep_for > 0 and not runtime.shutdown_requested:
        interruptible_sleep(sleep_for, runtime)
