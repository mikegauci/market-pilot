from __future__ import annotations

import logging
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

from broker.execution import (
    EOD_RETRY_SEC,
    close_ibkr_signal_exits,
    collect_demotion_exit_symbols,
    collect_profit_take_trade_ids,
    force_eod_ibkr_exits,
    sync_ibkr_exits,
)
from broker.manual_close import process_manual_close_commands
from broker.ibkr import IBKRClient, MARKET_DATA_COMPETING_SESSION_MSG
from broker.reconcile import (
    nonzero_positions,
    reconcile_orphan_ibkr_positions,
    refresh_ibkr_bracket_targets,
)
from config import Settings, load_settings
from execution_mode import effective_execution_mode
from instance_lock import acquire_trader_lock
from database.supabase import GENERAL_NEWS_FAILURE_BACKOFF_SEC, SupabaseRepository
from jev.client import JevClient
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from news.cache import TtlCache
from news.client import FetchStatus, FinnhubNewsClient, NewsService
from news.enrich import enrich_market_state_with_news
from news.sentiment import NewsContext
from market.hours import (
    is_us_regular_session_open,
    should_force_eod_flatten,
)
from market.indicators import build_market_state
from market.mock import MockMarketProvider
from models.types import (
    BotStatusUpdate,
    DataSource,
    ExecutionMode,
    JevPrediction,
    MarketState,
    Quote,
    RiskSettings,
    TradingMode,
)
from risk.manager import RiskManager
from strategy.confirmation import ConfirmationTracker
from strategy.profit_take_tracker import ProfitTakeBandTracker
from strategy.config import strategy_config_with_risk_overrides
from watchlist.demotion import effective_max_hold_minutes
from watchlist.jev_screener import (
    apply_screener_result_to_risk_settings,
    effective_benchmark,
    merge_core_watchlist,
    resolve_runtime_watchlist,
    resolve_trading_watchlist,
    screener_due,
    strip_benchmark_symbol,
)
from watchlist.screener_scheduler import (
    EMWatchlistScheduler,
    ScreenerJobContext,
    backfill_watchlist_symbols,
)
from watchlist.universe import load_em_universe
from runtime.capital import resolve_effective_capital, sync_risk_manager_capital
from runtime.entry_eval import process_ready_states
from runtime.heartbeat import run_heartbeat_cycle
from runtime.sim_close import persist_simulated_closes
from runtime.startup import connect_ibkr_with_retries, run_ibkr_startup_backfill
from runtime.state import TraderRuntimeState
from runtime.status_log import log_trader_running
from runtime.timing import compute_loop_sleep_sec, should_refresh

logger = logging.getLogger(__name__)

_loop_runtime: Optional[TraderRuntimeState] = None
_PREDICTION_BACKFILL_INTERVAL_SEC = 60.0
_CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0
_MARKET_DATA_WARN_INTERVAL_SEC = 300.0
_SHUTDOWN_SLEEP_CHUNK_SEC = 0.5


def eval_allow_five_min_fallback(
    is_open_position: bool,
    symbol_intraday_bars: Optional[Sequence[object]],
    warmup_min_1m_bars: int,
) -> bool:
    """Use cached 5m bars for Jev when live 1m tape is still warming up.

    Open positions already had this path; extend it to any symbol with enough
    intraday history (e.g. US mega-caps backfilled at startup or after a pin).
    """
    if is_open_position:
        return True
    return (
        symbol_intraday_bars is not None
        and len(symbol_intraday_bars) >= warmup_min_1m_bars
    )


def build_eval_symbols(
    watchlist: Sequence[str],
    open_symbols: Sequence[str],
    risk_settings: Optional[RiskSettings],
) -> List[str]:
    """Symbols to evaluate for entries/exits.

    Benchmark is stripped from the watchlist (never an entry candidate) but open
    positions are always kept so Jev/signal exits still run on a held benchmark.
    """
    if risk_settings is not None:
        entry_candidates = strip_benchmark_symbol(watchlist, risk_settings)
    else:
        entry_candidates = list(watchlist)
    merged: List[str] = []
    for raw in list(entry_candidates) + list(open_symbols):
        symbol = str(raw).upper()
        if symbol and symbol not in merged:
            merged.append(symbol)
    return merged


def _handle_shutdown(signum: int, _frame: object) -> None:
    global _loop_runtime
    logger.info("Received signal %s, shutting down...", signum)
    if _loop_runtime is not None:
        _loop_runtime.shutdown_requested = True


def _interruptible_sleep(seconds: float, runtime: TraderRuntimeState) -> None:
    deadline = time.monotonic() + seconds
    while not runtime.shutdown_requested:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(_SHUTDOWN_SLEEP_CHUNK_SEC, remaining))


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    # ib_insync logs every orderStatus tick at INFO — far too noisy for normal use.
    logging.getLogger("ib_insync").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def _all_symbols(watchlist: list[str], benchmark: str = "SPY") -> list[str]:
    benchmark_symbol = (benchmark or "SPY").upper()
    return list(dict.fromkeys(watchlist + [benchmark_symbol]))


def _load_em_universe(settings: Settings, db: SupabaseRepository) -> List[str]:
    return load_em_universe(db=db, path=Path(settings.resolved_em_universe_path))


def _seed_universe_minute_bars_mock(
    universe: List[str],
    mock: MockMarketProvider,
    minute_bars: MinuteBarStore,
) -> None:
    mock.ensure_symbols(universe)
    for symbol in universe:
        mock.seed_symbol_minute_bars(minute_bars, symbol)


def _seed_universe_minute_bars_from_cache(
    universe: List[str],
    bar_store: BarStore,
    minute_bars: MinuteBarStore,
) -> None:
    for symbol in universe:
        bar_store.seed_minute_aggregator(minute_bars.get(symbol), symbol)


def _apply_watchlist_update(
    watchlist: List[str],
    benchmark_symbol: str,
    mock: MockMarketProvider,
    ibkr: IBKRClient,
    settings: Settings,
) -> List[str]:
    all_symbols = _all_symbols(watchlist, benchmark_symbol)
    mock.ensure_symbols(all_symbols)
    if settings.data_source == DataSource.IBKR and ibkr.is_connected():
        ibkr.sync_watchlist_subscriptions(all_symbols)
    return all_symbols


def _sync_watchlist_symbols(
    all_symbols: list[str],
    mock: MockMarketProvider,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    data_source: DataSource,
    runtime: TraderRuntimeState,
) -> List[str]:
    """Pick up watchlist changes at runtime without restarting the trader."""
    mock.ensure_symbols(all_symbols)
    new_symbols = [
        symbol
        for symbol in all_symbols
        if minute_bars.get(symbol).bar_count() == 0
    ]
    for symbol in new_symbols:
        if data_source == DataSource.MOCK:
            mock.seed_symbol_minute_bars(minute_bars, symbol)
        else:
            bar_store.seed_minute_aggregator(minute_bars.get(symbol), symbol)
        runtime.warmup_logged.discard(symbol)
    if new_symbols:
        logger.info(
            "Watchlist expanded — seeded 1-min bars for: %s",
            ", ".join(new_symbols),
        )
    return new_symbols


def _pulse_bot_status(
    db: SupabaseRepository,
    *,
    enabled: bool,
    trading_mode: TradingMode,
    execution_mode: ExecutionMode,
    ibkr_connected: bool,
    jev_connected: bool = False,
    last_error: Optional[str] = None,
) -> None:
    """Lightweight status write so the dashboard shows online during long startup work."""
    try:
        db.update_bot_status(
            BotStatusUpdate(
                enabled=enabled,
                trading_mode=trading_mode,
                execution_mode=execution_mode,
                ibkr_connected=ibkr_connected,
                jev_connected=jev_connected,
                last_error=last_error,
            )
        )
    except Exception as exc:
        logger.warning("Bot status pulse failed: %s", exc)


def _get_quotes(
    settings: Settings,
    ibkr: IBKRClient,
    mock: MockMarketProvider,
    symbols: list[str],
) -> list[Quote]:
    if settings.data_source == DataSource.IBKR and ibkr.is_connected():
        return ibkr.get_quotes(symbols, wait_sec=0.5)
    return mock.get_quotes(symbols)


def _sync_portfolio_state(
    db: SupabaseRepository,
    ibkr: IBKRClient,
    risk_manager: Optional[RiskManager],
    execution_mode: ExecutionMode,
    quotes: list[Quote],
) -> None:
    """Push equity and positions to Supabase for dashboard Realtime updates."""
    account = None
    ibkr_positions = None
    simulated_portfolio = None
    open_trades = None

    if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
        try:
            account = ibkr.get_account_summary()
            ibkr_positions = nonzero_positions(ibkr.get_positions())
        except Exception as exc:
            logger.warning("Portfolio sync failed (IBKR): %s", exc)
            return
    elif risk_manager:
        quotes_by_symbol = {q.symbol: q for q in quotes}
        simulated_portfolio = risk_manager.get_portfolio_snapshot(quotes_by_symbol)
        open_trades = risk_manager.open_trades
    else:
        return

    db.write_portfolio_state(
        quotes,
        account=account,
        ibkr_positions=ibkr_positions,
        simulated_portfolio=simulated_portfolio,
        open_trades=open_trades,
    )


def _init_risk_manager(
    db: SupabaseRepository,
    ibkr: IBKRClient,
    trading_mode: TradingMode,
    risk_settings: RiskSettings | None = None,
    ibkr_account_id: str | None = None,
) -> RiskManager:
    if risk_settings is None:
        risk_settings = db.get_risk_settings()
    capital, currency = resolve_effective_capital(ibkr, risk_settings.account_capital)
    manager = RiskManager(
        settings=risk_settings,
        trading_mode=trading_mode,
        effective_capital=capital,
        open_trades=db.get_open_trades(ibkr_account_id),
        daily_realized_pnl=db.get_daily_realized_pnl(ibkr_account_id),
        total_realized_pnl=db.get_total_realized_pnl(ibkr_account_id),
        currency=currency,
    )
    sync_risk_manager_capital(manager, ibkr, risk_settings.account_capital)
    manager.hydrate_reentry_cooldowns(
        db.get_recent_symbol_exit_times(risk_settings.reentry_cooldown_minutes)
    )
    return manager


def _fetch_jev_predictions(
    jev: JevClient,
    ready_states: List[Tuple[str, MarketState]],
    max_workers: int,
) -> Dict[str, JevPrediction]:
    """Call Jev in parallel so one slow symbol does not block the watchlist."""
    if not ready_states:
        return {}

    workers = min(max_workers, len(ready_states))
    predictions: Dict[str, JevPrediction] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(jev.predict, state): symbol for symbol, state in ready_states
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                predictions[symbol] = future.result()
            except Exception as exc:
                logger.error("Jev prediction failed for %s: %s", symbol, exc)
    return predictions


def run() -> int:
    global _loop_runtime
    acquire_trader_lock()
    runtime = TraderRuntimeState()
    _loop_runtime = runtime
    settings = load_settings()
    _configure_logging(settings.log_level)

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
    if not settings.forward_return_backfill_enabled:
        logger.info(
            "15m forward-return backfill disabled (calibration analytics only)"
        )

    db: Optional[SupabaseRepository] = None
    try:
        db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as exc:
        logger.error("Supabase initialization failed: %s", exc)
        return 1

    risk_settings = db.get_risk_settings()
    watchlist = resolve_runtime_watchlist(
        risk_settings,
        env_fallback=settings.watchlist_symbols,
    )
    benchmark_symbol = effective_benchmark(risk_settings)
    all_symbols = _all_symbols(watchlist, benchmark_symbol)
    em_scheduler = EMWatchlistScheduler()

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

    strategy_config = strategy_config_with_risk_overrides(
        settings.strategy_config,
        min_volume_ratio=risk_settings.min_volume_ratio,
        min_share_price=risk_settings.min_share_price,
        min_dollar_volume=risk_settings.min_dollar_volume,
        jev_sell_exit_threshold=risk_settings.jev_sell_exit_threshold,
        confirmation_cycles=risk_settings.confirmation_cycles,
        confirmation_seconds=risk_settings.confirmation_seconds,
    )
    confirmation_tracker = ConfirmationTracker(
        strategy_config.confirmation_cycles,
        required_seconds=strategy_config.confirmation_seconds,
    )
    profit_take_tracker = ProfitTakeBandTracker(
        risk_settings.profit_take_band_window_cycles,
    )
    logger.info(
        "Strategy filters: min confidence from settings, margin %.0f%%, "
        "confirmation %sx, max hold %.0fm (dashboard), min hold %.0fm, "
        "Jev SELL exit >= %.0f%%, min volume ratio %.2f, "
        "min share price $%.2f (dashboard)",
        strategy_config.min_buy_hold_margin * 100,
        strategy_config.confirmation_cycles,
        risk_settings.max_hold_minutes,
        risk_settings.min_hold_minutes,
        strategy_config.jev_sell_exit_threshold * 100,
        risk_settings.min_volume_ratio,
        risk_settings.min_share_price,
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
        news_client = FinnhubNewsClient(
            settings.finnhub_api_key,
            lookback_hours=settings.news_lookback_hours,
            max_headlines=settings.news_max_headlines,
            max_retries=settings.news_max_retries,
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
            "News enrichment enabled (Finnhub, cache TTL %.0fs, general refresh %.0fs, skip %s)",
            settings.news_cache_ttl_sec,
            settings.news_general_refresh_sec,
            ", ".join(sorted(settings.news_skip_symbol_set)) or "none",
        )
    elif settings.data_source == DataSource.MOCK:
        logger.info("News enrichment skipped in mock data mode")

    bot_control = db.get_bot_control(settings.execution_mode)
    trading_mode = bot_control.trading_mode
    configured_execution_mode = bot_control.execution_mode
    _pulse_bot_status(
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
            _pulse_bot_status(
                db,
                enabled=bot_control.enabled,
                trading_mode=trading_mode,
                execution_mode=configured_execution_mode,
                ibkr_connected=True,
                jev_connected=False,
            )

            def _on_backfill_progress(result: object, index: int, total: int) -> None:
                del result
                if index == 1 or index == total or index % 5 == 0:
                    logger.info("Watchlist backfill progress %s/%s", index, total)
                    _pulse_bot_status(
                        db,
                        enabled=bot_control.enabled,
                        trading_mode=trading_mode,
                        execution_mode=configured_execution_mode,
                        ibkr_connected=True,
                        jev_connected=False,
                    )

            open_symbols = [trade.symbol for trade in db.get_open_trades()]
            priority_symbols = list(
                dict.fromkeys(
                    merge_core_watchlist(risk_settings, open_symbols)
                    + resolve_trading_watchlist(risk_settings, open_symbols)
                )
            )
            run_ibkr_startup_backfill(
                settings=settings,
                db=db,
                bar_store=bar_store,
                ibkr=ibkr,
                risk_settings=risk_settings,
                em_scheduler=em_scheduler,
                load_em_universe_fn=lambda: _load_em_universe(settings, db),
                on_progress=_on_backfill_progress,
            )
            for symbol in priority_symbols:
                bar_store.seed_minute_aggregator(
                    minute_bars.get(symbol), symbol
                )
            _pulse_bot_status(
                db,
                enabled=bot_control.enabled,
                trading_mode=trading_mode,
                execution_mode=configured_execution_mode,
                ibkr_connected=True,
                jev_connected=False,
            )
        else:
            logger.warning("IBKR unavailable — falling back to mock market data")
            _pulse_bot_status(
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
        risk_manager = _init_risk_manager(
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
                _sync_portfolio_state(db, ibkr, risk_manager, execution_mode, [])

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

    def _start_general_news_refresh() -> None:
        nonlocal last_general_news_refresh, general_news_running
        if news_client is None or db is None:
            return
        with general_news_lock:
            if general_news_running:
                return
            general_news_running = True
            # Prevent re-fire while the worker is in flight.
            last_general_news_refresh = time.monotonic()

        client = news_client
        repo = db
        keep = settings.news_general_keep
        full_interval = settings.news_general_refresh_sec

        def worker() -> None:
            nonlocal last_general_news_refresh, general_news_running
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
                        last_general_news_refresh = now
                    else:
                        # Retry sooner than the full refresh interval.
                        backoff = min(GENERAL_NEWS_FAILURE_BACKOFF_SEC, full_interval)
                        last_general_news_refresh = now - full_interval + backoff
                    general_news_running = False

        threading.Thread(
            target=worker,
            name="general-market-news",
            daemon=True,
        ).start()

    while not runtime.shutdown_requested:
        loop_start = time.monotonic()
        jev_connected_this_cycle = False
        market_open = True
        portfolio_dirty = False

        try:
            if db:
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
                        last_general_news_refresh,
                        settings.news_general_refresh_sec,
                    )
                ):
                    _start_general_news_refresh()

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
                watchlist = resolve_runtime_watchlist(
                    risk_settings,
                    open_symbols,
                    env_fallback=settings.watchlist_symbols,
                )
                screener_result = em_scheduler.take_completed_screener_result()
                if screener_result is not None:
                    watchlist = strip_benchmark_symbol(
                        screener_result.watchlist, risk_settings
                    )
                    apply_screener_result_to_risk_settings(
                        risk_settings,
                        watchlist=screener_result.watchlist,
                        rankings=screener_result.rankings,
                        screener_ran_at=screener_result.screener_ran_at,
                    )
                if jev is not None and risk_settings.watchlist_dynamic_enabled:
                    quote_snapshot = None
                    # Capture live spreads only when a scan is about to start —
                    # worker thread cannot call IBKR safely.
                    if screener_due(risk_settings) and (
                        settings.data_source != DataSource.IBKR
                        or is_us_regular_session_open()
                    ):
                        try:
                            snapshot_symbols = list(
                                dict.fromkeys(
                                    merge_core_watchlist(risk_settings, open_symbols)
                                    + [benchmark_symbol]
                                    + open_symbols
                                )
                            )
                            quote_snapshot = {
                                quote.symbol.upper(): quote
                                for quote in _get_quotes(
                                    settings, ibkr, mock, snapshot_symbols
                                )
                            }
                        except Exception as exc:
                            logger.warning(
                                "Could not capture screener quote snapshot: %s",
                                exc,
                            )
                    em_scheduler.maybe_start_screener(
                        ScreenerJobContext(
                            settings=settings,
                            risk_settings=risk_settings,
                            db=db,
                            jev=jev,
                            minute_bars=minute_bars,
                            bar_store=bar_store,
                            mock=mock,
                            ibkr=ibkr,
                            open_symbols=open_symbols,
                            strategy_config=strategy_config,
                            news_service=news_service,
                            get_quotes=lambda symbols: _get_quotes(
                                settings, ibkr, mock, symbols
                            ),
                            quote_snapshot=quote_snapshot,
                        )
                    )
                all_symbols = _all_symbols(
                    list(dict.fromkeys(watchlist + open_symbols)),
                    benchmark_symbol,
                )
                if screener_result is not None:
                    all_symbols = _apply_watchlist_update(
                        watchlist,
                        benchmark_symbol,
                        mock,
                        ibkr,
                        settings,
                    )
                new_watchlist_symbols = _sync_watchlist_symbols(
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

            quotes = _get_quotes(settings, ibkr, mock, all_symbols)
            quotes_by_symbol: Dict[str, Quote] = {q.symbol: q for q in quotes}

            if (
                settings.data_source == DataSource.IBKR
                and ibkr.is_connected()
                and runtime.ibkr_market_data_mode == "unavailable"
            ):
                now_mono = time.monotonic()
                if (now_mono - runtime.last_market_data_warn) >= _MARKET_DATA_WARN_INTERVAL_SEC:
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
                        quotes = _get_quotes(settings, ibkr, mock, all_symbols)
                        quotes_by_symbol = {q.symbol: q for q in quotes}

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
                def _max_hold_for_symbol(symbol: str) -> float:
                    return effective_max_hold_minutes(symbol, risk_settings)

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

                closed_demotion = risk_manager.check_demotion_exits(quotes_by_symbol)
                if persist_simulated_closes(
                    db,
                    risk_manager,
                    closed_demotion,
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
                    demotion_exit_symbols = collect_demotion_exit_symbols(
                        risk_manager.open_trades,
                        risk_settings,
                    )
                    refresh_ibkr_bracket_targets(ibkr, risk_manager, db)
                    if demotion_exit_symbols:
                        demotion_closed, _ = close_ibkr_signal_exits(
                            ibkr,
                            risk_manager,
                            db,
                            max_hold_for_symbol=_max_hold_for_symbol,
                            demotion_exit_symbols=demotion_exit_symbols,
                            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                            ibkr_account_id=daily_pnl_account_id,
                        )
                        if demotion_closed:
                            portfolio_dirty = True

            if portfolio_dirty and db:
                _sync_portfolio_state(
                    db, ibkr, risk_manager, execution_mode, quotes
                )
                portfolio_dirty = False

            benchmark_symbol = (
                effective_benchmark(risk_settings) if db and risk_settings else "SPY"
            )
            benchmark_key = benchmark_symbol.upper()
            benchmark_minute_bars = minute_bars.get(benchmark_key)
            benchmark_intraday_bars = (
                bar_store.get_intraday_bars(benchmark_key) if bar_store else None
            )
            market_open = (
                settings.data_source != DataSource.IBKR or is_us_regular_session_open()
            )
            if not market_open:
                now_mono = time.monotonic()
                if (
                    now_mono - runtime.last_closed_market_log
                ) >= _CLOSED_MARKET_LOG_INTERVAL_SEC:
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

                if jev is None:
                    continue

                ready_states.append(
                    (symbol, enrich_market_state_with_news(state, news_service))
                )

            if jev is not None and ready_states:
                predictions_by_symbol = _fetch_jev_predictions(
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
            prediction_rows = eval_outcome.prediction_rows
            if eval_outcome.portfolio_dirty:
                portfolio_dirty = True
            jev_sell_symbols.update(eval_outcome.jev_sell_symbols)

            if db and prediction_rows:
                db.insert_predictions_batch(prediction_rows)
                logger.info("Stored %s prediction(s)", len(prediction_rows))

            if db and settings.forward_return_backfill_enabled:
                backfill_now = time.monotonic()
                if (
                    backfill_now - runtime.last_prediction_backfill_mono
                ) >= _PREDICTION_BACKFILL_INTERVAL_SEC:
                    runtime.last_prediction_backfill_mono = backfill_now
                    db.backfill_prediction_forward_returns(limit=400)

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
                    max_hold_for_symbol=lambda sym: effective_max_hold_minutes(
                        sym, risk_settings
                    ),
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
                _sync_portfolio_state(
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
                _CLOSED_MARKET_LOG_INTERVAL_SEC,
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
        if sleep_for > 0 and not runtime.shutdown_requested:
            _interruptible_sleep(sleep_for, runtime)

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
