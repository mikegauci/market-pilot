from __future__ import annotations

import logging
import signal
import sys
from dataclasses import replace
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from broker.ibkr import IBKRClient
from broker.reconcile import reconcile_orphan_ibkr_positions
from config import load_settings
from database.supabase import GENERAL_NEWS_FAILURE_BACKOFF_SEC, SupabaseRepository
from execution_mode import effective_execution_mode
from instance_lock import acquire_trader_lock
from jev.client import JevClient
from jev.shadow_read import OpenAiShadowReader
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_us_regular_session_open
from market.mock import MockMarketProvider
from models.types import DataSource, ExecutionMode, TradingMode
from news.cache import TtlCache
from news.client import FetchStatus, FinnhubNewsClient, NewsService
from news.openai_scorer import OpenAiNewsScorer
from news.sentiment import NewsContext
from notify.telegram import configure_telegram
from risk.manager import RiskManager
from runtime.entry_eval import process_ready_states
from runtime.loop.eval_cycle import EvalCycleContext, run_eval_cycle
from runtime.periodic import periodic_callback
from runtime.shutdown_control import (
    StartupShutdownAction,
    resolve_startup_entry_enabled,
    resolve_startup_shutdown_action,
)
from runtime.startup import connect_ibkr_with_retries, run_ibkr_startup_backfill
from runtime.state import TraderRuntimeState
from runtime.status_log import log_trader_running
from runtime.trader_ops import (
    merge_watchlist_symbols,
    configure_logging,
    init_risk_manager,
    pulse_bot_status,
    sync_portfolio_state,
)
from strategy.confirmation import ConfirmationTracker
from watchlist.breakout_runtime import restore_breakout_windows
from strategy.config import (
    rotation_dashboard_override,
    entry_ema_dashboard_override,
    breakout_dashboard_override,
    entry_rsi_spread_dashboard_overrides,
    strategy_config_with_risk_overrides,
)
from strategy.profit_take_tracker import ProfitTakeBandTracker
from watchlist.resolution import effective_benchmark, resolve_runtime_watchlist

logger = logging.getLogger(__name__)

_loop_runtime: Optional[TraderRuntimeState] = None


def _handle_shutdown(signum: int, _frame: object) -> None:
    global _loop_runtime
    logger.info("Received signal %s, shutting down...", signum)
    if _loop_runtime is not None:
        _loop_runtime.shutdown_requested = True


def run() -> int:
    global _loop_runtime
    acquire_trader_lock()
    runtime = TraderRuntimeState()
    _loop_runtime = runtime
    settings = load_settings()
    configure_logging(settings.log_level)

    logger.info("=== %s ===", settings.mode_banner)
    logger.info(
        "Data source: %s | Execution: %s | Eval interval: %ss | Heartbeat: %ss",
        settings.data_source.value,
        settings.execution_mode.value,
        settings.eval_interval_sec,
        settings.heartbeat_interval_sec,
    )
    logger.info(
        "Supabase sync: bot control every %.0fs, settings every %.0fs, "
        "portfolio history every %.0fs",
        settings.bot_control_refresh_interval_sec,
        settings.settings_refresh_interval_sec,
        settings.portfolio_history_interval_sec,
    )
    configure_telegram(settings.telegram_bot_token, settings.telegram_chat_id)
    if settings.telegram_bot_token.strip() and settings.telegram_chat_id.strip():
        logger.info("Telegram trade alerts enabled")
    db: Optional[SupabaseRepository] = None
    try:
        db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as exc:
        logger.error("Supabase initialization failed: %s", exc)
        return 1

    risk_settings = db.get_risk_settings()
    restored_breakouts = restore_breakout_windows(
        runtime,
        db.get_watchlist_rotation_history(),
        now_mono=time.monotonic(),
    )
    if restored_breakouts:
        logger.info("Restored breakout windows: %s", ", ".join(restored_breakouts))
    watchlist = resolve_runtime_watchlist(
        risk_settings,
        env_fallback=settings.watchlist_symbols,
    )
    benchmark_symbol = effective_benchmark(risk_settings)
    all_symbols = merge_watchlist_symbols(watchlist, benchmark_symbol)
    bar_store = BarStore(
        db,
        daily_duration=settings.bar_daily_duration,
        intraday_duration=settings.bar_intraday_duration,
        backfill_pacing_sec=settings.bar_backfill_pacing_sec,
    )
    mock = MockMarketProvider(all_symbols)
    minute_bars = MinuteBarStore(all_symbols)
    if settings.data_source == DataSource.MOCK:
        mock.seed_minute_bars(minute_bars)
        logger.info("Seeded mock 1-minute bars for indicators")
    else:
        for symbol in all_symbols:
            bar_store.seed_minute_aggregator(minute_bars.get(symbol), symbol)
        logger.info(
            "Seeded 1-minute bars from cache (need %s bars for warm-up)",
            settings.strategy_config.warmup_min_1m_bars,
        )

    strategy_config = replace(
        strategy_config_with_risk_overrides(
            settings.strategy_config,
            min_volume_ratio=risk_settings.min_volume_ratio,
            min_share_price=risk_settings.min_share_price,
            min_dollar_volume=risk_settings.min_dollar_volume,
            jev_sell_exit_threshold=risk_settings.jev_sell_exit_threshold,
            confirmation_cycles=risk_settings.confirmation_cycles,
            confirmation_seconds=risk_settings.confirmation_seconds,
            **rotation_dashboard_override(
                from_settings=risk_settings.rotation_session_pct_from_settings,
                value=risk_settings.rotation_min_session_change_pct,
            ),
            **entry_ema_dashboard_override(
                from_settings=risk_settings.entry_ema_gate_from_settings,
                value=risk_settings.entry_ema_gate,
            ),
            **entry_rsi_spread_dashboard_overrides(
                max_rsi_from_settings=risk_settings.max_rsi_from_settings,
                max_rsi=risk_settings.max_rsi,
                max_spread_pct_from_settings=risk_settings.max_spread_pct_from_settings,
                max_spread_pct=risk_settings.max_spread_pct,
            ),
        ),
        **breakout_dashboard_override(
            from_settings=risk_settings.breakout_from_settings,
            enabled=risk_settings.breakout_enabled,
            lookback_minutes=risk_settings.breakout_lookback_minutes,
            min_volume_ratio=risk_settings.breakout_min_volume_ratio,
            min_change_5m_pct=risk_settings.breakout_min_change_5m_pct,
            max_promotions_per_cycle=risk_settings.breakout_max_promotions_per_cycle,
            window_minutes=risk_settings.breakout_window_minutes,
            max_rsi=risk_settings.breakout_max_rsi,
        ),
    )
    confirmation_tracker = ConfirmationTracker(
        strategy_config.confirmation_cycles,
        required_seconds=strategy_config.confirmation_seconds,
    )
    profit_take_tracker = ProfitTakeBandTracker(
        risk_settings.profit_take_band_window_cycles,
    )
    loss_cut_tracker = ProfitTakeBandTracker(
        risk_settings.loss_cut_band_window_cycles,
    )
    logger.info(
        "Strategy filters: min confidence from settings, margin %.0f%%, "
        "confirmation %sx, max hold %.0fm (dashboard), min hold %.0fm, "
        "Jev SELL exit >= %.0f%%, min volume ratio %.2f, "
        "min share price $%.2f (dashboard), rotation session %% %s",
        strategy_config.min_buy_hold_margin * 100,
        strategy_config.confirmation_cycles,
        risk_settings.max_hold_minutes,
        risk_settings.min_hold_minutes,
        strategy_config.jev_sell_exit_threshold * 100,
        risk_settings.min_volume_ratio,
        risk_settings.min_share_price,
        "off"
        if strategy_config.rotation_min_session_change_pct is None
        else f">= {strategy_config.rotation_min_session_change_pct:.2f}",
    )

    ibkr = IBKRClient(
        host=settings.ibkr_host,
        port=settings.ibkr_port,
        client_id=settings.ibkr_client_id,
        account=settings.ibkr_account,
        market_data_type=settings.ibkr_market_data_type,
    )

    jev: Optional[JevClient] = None
    if settings.jev_enabled:
        if settings.typesafe_ai_api_key:
            jev = JevClient(
                api_key=settings.typesafe_ai_api_key,
                model=settings.jev_model,
                timeout_sec=settings.jev_timeout_sec,
            )
        else:
            logger.warning("JEV_ENABLED=true but TYPESAFE_AI_API_KEY is not set — skipping Jev calls")

    news_service: Optional[NewsService] = None
    news_client: Optional[FinnhubNewsClient] = None
    if settings.news_enabled and settings.data_source != DataSource.MOCK:
        news_llm_scorer: Optional[OpenAiNewsScorer] = None
        if settings.news_llm_enabled:
            news_llm_scorer = OpenAiNewsScorer(
                settings.openai_api_key,
                model=settings.news_llm_model,
                timeout_sec=settings.news_llm_timeout_sec,
            )
        news_client = FinnhubNewsClient(
            settings.finnhub_api_key,
            lookback_hours=settings.news_lookback_hours,
            max_headlines=settings.news_max_headlines,
            max_retries=settings.news_max_retries,
            scorer=news_llm_scorer,
        )
        news_cache: TtlCache[NewsContext] = TtlCache(settings.news_cache_ttl_sec)
        news_service = NewsService(
            news_client,
            news_cache,
            skip_symbols=settings.news_skip_symbol_set,
            empty_cooldown_sec=settings.news_empty_cooldown_sec,
            failure_cooldown_sec=settings.news_failure_cooldown_sec,
            fetch_workers=settings.news_fetch_workers,
        )
        logger.info(
            "News enrichment enabled (Finnhub, cache TTL %.0fs, general refresh %.0fs, skip %s%s)",
            settings.news_cache_ttl_sec,
            settings.news_general_refresh_sec,
            ", ".join(sorted(settings.news_skip_symbol_set)) or "none",
            f", OpenAI scorer {settings.news_llm_model}" if news_llm_scorer else "",
        )
    elif settings.data_source == DataSource.MOCK:
        logger.info("News enrichment skipped in mock data mode")

    shadow_reader: Optional[OpenAiShadowReader] = None
    if settings.openai_shadow_read_enabled:
        shadow_reader = OpenAiShadowReader(
            settings.openai_api_key,
            model=settings.news_llm_model,
        )
        logger.info("OpenAI Jev shadow reads enabled (%s)", settings.news_llm_model)

    bot_control = db.get_bot_control(settings.execution_mode)
    startup_shutdown = resolve_startup_shutdown_action(
        bot_control.shutdown_requested,
        db.get_last_heartbeat(),
    )
    if startup_shutdown == StartupShutdownAction.EXIT_PENDING_STOP:
        logger.info(
            "Dashboard stop is still pending (fresh heartbeat) — exiting without starting"
        )
        db.mark_shutdown_gate_offline(
            bot_control.enabled,
            bot_control.trading_mode,
            bot_control.execution_mode,
        )
        return 0
    if startup_shutdown == StartupShutdownAction.BLOCK_UNTIL_CANCEL:
        logger.error(
            "Dashboard stop request is active — use Cancel stop in the dashboard, "
            "then start the trader again"
        )
        return 1
    entry_enabled, resumed_offline_pause = resolve_startup_entry_enabled(
        bot_control.enabled
    )
    if resumed_offline_pause:
        logger.info(
            "Resuming new trades on startup (dashboard had new entries paused while offline)"
        )
    bot_control.enabled = entry_enabled
    trading_mode = bot_control.trading_mode
    configured_execution_mode = bot_control.execution_mode
    pulse_bot_status(
        db,
        enabled=bot_control.enabled,
        trading_mode=trading_mode,
        execution_mode=configured_execution_mode,
        ibkr_connected=False,
        jev_connected=False,
    )

    if settings.data_source == DataSource.IBKR:
        if connect_ibkr_with_retries(ibkr, max_attempts=3):
            runtime.ibkr_market_data_mode = ibkr.ensure_market_data_ready(all_symbols)
            logger.info(
                "Connected to IBKR (%s:%s) — market data mode: %s",
                settings.ibkr_host,
                settings.ibkr_port,
                runtime.ibkr_market_data_mode,
            )
            startup_ibkr_error: str | None = None
            if runtime.ibkr_market_data_mode == "unavailable":
                startup_ibkr_error = (
                    "IBKR quotes unavailable — close TWS, IBKR mobile, and other API "
                    "sessions, restart IB Gateway, then restart the trader."
                )
            elif ibkr.market_data_is_blocked():
                startup_ibkr_error = (
                    "Another IB app is using live market data — close it and restart "
                    "IB Gateway so the bot can get prices."
                )

            def _startup_status_pulse(*, jev_connected: bool = False) -> None:
                pulse_bot_status(
                    db,
                    enabled=bot_control.enabled,
                    trading_mode=trading_mode,
                    execution_mode=configured_execution_mode,
                    ibkr_connected=True,
                    jev_connected=jev_connected,
                    last_error=startup_ibkr_error,
                )

            _startup_status_pulse()

            def _on_backfill_progress(result: object, index: int, total: int) -> None:
                del result
                if index == 1 or index == total or index % 5 == 0:
                    logger.info("Watchlist backfill progress %s/%s", index, total)
                _startup_status_pulse()

            with periodic_callback(
                settings.heartbeat_interval_sec,
                _startup_status_pulse,
                name="startup-heartbeat",
            ):
                run_ibkr_startup_backfill(
                    settings=settings,
                    db=db,
                    bar_store=bar_store,
                    ibkr=ibkr,
                    risk_settings=risk_settings,
                    runtime=runtime,
                    on_progress=_on_backfill_progress,
                )
            open_symbols = [trade.symbol for trade in db.get_open_trades()]
            for symbol in resolve_runtime_watchlist(
                risk_settings, open_symbols, env_fallback=settings.watchlist_symbols
            ):
                bar_store.seed_minute_aggregator(
                    minute_bars.get(symbol), symbol
                )
            pulse_bot_status(
                db,
                enabled=bot_control.enabled,
                trading_mode=trading_mode,
                execution_mode=configured_execution_mode,
                ibkr_connected=True,
                jev_connected=False,
            )
        else:
            logger.warning("IBKR unavailable — falling back to mock market data")
            pulse_bot_status(
                db,
                enabled=bot_control.enabled,
                trading_mode=trading_mode,
                execution_mode=configured_execution_mode,
                ibkr_connected=False,
                jev_connected=False,
                last_error="IBKR unavailable — using mock data",
            )
    else:
        logger.info("Using mock market data (IBKR not required)")

    execution_mode = effective_execution_mode(
        settings.data_source, configured_execution_mode
    )
    startup_ibkr_account_id: str | None = None
    if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
        try:
            startup_ibkr_account_id = ibkr.get_account_summary().account_id
        except Exception as exc:
            logger.warning("Could not read IBKR account at startup: %s", exc)
    risk_manager: Optional[RiskManager] = None
    if db:
        risk_manager = init_risk_manager(
            db,
            ibkr,
            trading_mode,
            risk_settings,
            ibkr_account_id=startup_ibkr_account_id,
        )
        if configured_execution_mode != settings.execution_mode:
            logger.info(
                "Execution mode from dashboard: %s (env default: %s)",
                configured_execution_mode.value,
                settings.execution_mode.value,
            )
        if execution_mode != configured_execution_mode:
            logger.info(
                "DATA_SOURCE=mock — using simulated execution for local dev "
                "(dashboard execution_mode remains %s)",
                configured_execution_mode.value,
            )
        logger.info(
            "Risk engine loaded — %s open simulated trades, capital $%.2f",
            len(risk_manager.open_trades),
            risk_manager.effective_capital,
        )

        reclaimed = db.reclaim_stale_trade_commands()
        if reclaimed:
            logger.info(
                "Reclaimed %s stale manual close command(s) on startup",
                reclaimed,
            )
        entry_reclaimed = db.reclaim_stale_entry_commands()
        if entry_reclaimed:
            logger.info(
                "Reclaimed %s stale manual entry command(s) on startup",
                entry_reclaimed,
            )

        if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
            reconciled = reconcile_orphan_ibkr_positions(
                ibkr,
                risk_manager,
                db,
                trading_mode,
                risk_settings,
                watchlist=watchlist,
            )
            if reconciled:
                logger.info(
                    "Startup reconciliation complete — %s orphan IBKR position(s) adopted",
                    reconciled,
                )
                sync_portfolio_state(db, ibkr, risk_manager, execution_mode, [])

    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    bot_enabled = bot_control.enabled
    jev_connected = False
    startup_mono = time.monotonic()
    last_heartbeat = 0.0
    last_bot_control_sync = startup_mono
    last_settings_sync = startup_mono
    last_portfolio_history = 0.0
    active_ibkr_account_id: str | None = startup_ibkr_account_id
    last_live_bar_flush = 0.0
    last_general_news_refresh = 0.0
    runtime.last_rotation_mono = startup_mono
    general_news_running = False
    general_news_lock = threading.Lock()
    data_source_label = "ibkr" if ibkr.is_connected() else "mock"

    startup_market_open = (
        settings.data_source != DataSource.IBKR or is_us_regular_session_open()
    )
    open_count = len(risk_manager.open_trades) if risk_manager else 0
    log_trader_running(
        bot_enabled=bot_enabled,
        market_open=startup_market_open,
        ibkr_connected=ibkr.is_connected(),
        jev_connected=jev is not None,
        execution_mode=execution_mode,
        open_trades=open_count,
        ibkr_account_id=active_ibkr_account_id,
        data_source=data_source_label,
    )
    runtime.last_trader_status_log_mono = time.monotonic()

    ctx = EvalCycleContext(
        runtime=runtime,
        settings=settings,
        db=db,
        mock=mock,
        minute_bars=minute_bars,
        bar_store=bar_store,
        ibkr=ibkr,
        jev=jev,
        news_service=news_service,
        news_client=news_client,
        last_general_news_refresh=last_general_news_refresh,
        risk_manager=risk_manager,
        confirmation_tracker=confirmation_tracker,
        profit_take_tracker=profit_take_tracker,
        loss_cut_tracker=loss_cut_tracker,
        bot_enabled=bot_enabled,
        trading_mode=trading_mode,
        configured_execution_mode=configured_execution_mode,
        execution_mode=execution_mode,
        last_bot_control_sync=last_bot_control_sync,
        last_settings_sync=last_settings_sync,
        last_heartbeat=last_heartbeat,
        last_portfolio_history=last_portfolio_history,
        last_live_bar_flush=last_live_bar_flush,
        active_ibkr_account_id=active_ibkr_account_id,
        jev_connected=jev_connected,
        risk_settings=risk_settings,
        strategy_config=strategy_config,
        watchlist=watchlist,
        all_symbols=all_symbols,
        data_source_label=data_source_label,
        shadow_reader=shadow_reader,
    )

    def _start_general_news_refresh() -> None:
        nonlocal general_news_running
        if ctx.news_client is None or db is None:
            return
        with general_news_lock:
            if general_news_running:
                return
            general_news_running = True
            # Prevent re-fire while the worker is in flight.
            ctx.last_general_news_refresh = time.monotonic()

        client = news_client
        repo = db
        keep = settings.news_general_keep
        full_interval = settings.news_general_refresh_sec

        def worker() -> None:
            nonlocal general_news_running
            success = False
            try:
                items, status = client.fetch_general_news(max_items=keep)
                if status == FetchStatus.OK and items:
                    fetched_at = datetime.now(timezone.utc).isoformat()
                    rows = [item.to_row(fetched_at=fetched_at) for item in items]
                    count = repo.upsert_market_news(rows, keep=keep)
                    logger.info("Upserted %s general market news articles", count)
                    success = True
                elif status == FetchStatus.EMPTY:
                    logger.info("General market news fetch returned empty")
                    success = True
                else:
                    logger.warning(
                        "General market news fetch status: %s", status.value
                    )
            except Exception as exc:
                logger.warning("General market news refresh failed: %s", exc)
            finally:
                now = time.monotonic()
                with general_news_lock:
                    if success:
                        ctx.last_general_news_refresh = now
                    else:
                        # Retry sooner than the full refresh interval.
                        backoff = min(GENERAL_NEWS_FAILURE_BACKOFF_SEC, full_interval)
                        ctx.last_general_news_refresh = now - full_interval + backoff
                    general_news_running = False

        threading.Thread(
            target=worker,
            name="general-market-news",
            daemon=True,
        ).start()

    while not runtime.shutdown_requested:
        run_eval_cycle(ctx, start_general_news_refresh=_start_general_news_refresh)

    if db:
        try:
            db.mark_trader_offline(
                bot_enabled, trading_mode, configured_execution_mode
            )
            logger.info("Marked trader offline in Supabase")
        except Exception as exc:
            logger.warning("Could not mark trader offline: %s", exc)
    if ibkr.is_connected():
        ibkr.disconnect()
    logger.info("Trading engine stopped.")
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
