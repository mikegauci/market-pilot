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

from alerts import build_notifier_from_env
from broker.eod import (
    entries_blocked_by_session,
    flatten_open_positions_eod,
    in_eod_closeout_window,
    in_eod_flat_verify_window,
    verify_flat_and_alert,
)
from broker.execution import (
    close_ibkr_signal_exits,
    collect_demotion_exit_symbols,
    sync_ibkr_exits,
)
from broker.manual_close import process_manual_close_commands
from broker.ibkr import (
    IBKRClient,
    MARKET_DATA_COMPETING_SESSION_MSG,
    is_kid_document_rejection,
    is_permanent_ibkr_eligibility_rejection,
)
from broker.reconcile import reconcile_orphan_ibkr_positions
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
from market.hours import get_session_clock, is_us_regular_session_open
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
from strategy.config import strategy_config_with_risk_overrides
from strategy.filters import check_correlation_cap, check_entry_filters
from strategy.signals import (
    is_sell_exit_eligible,
    is_trade_eligible,
    signal_tier,
    trade_skip_reason_from_tier,
)
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

logger = logging.getLogger(__name__)

_shutdown_requested = False
_warmup_logged: Set[str] = set()
_last_closed_market_log = 0.0
_last_market_data_warn = 0.0
_ibkr_market_data_mode = "stream"
_ibkr_entry_cooldown_until: Dict[str, float] = {}
_ibkr_entry_blocked: Set[str] = set()
_CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0
_MARKET_DATA_WARN_INTERVAL_SEC = 300.0
_SHUTDOWN_SLEEP_CHUNK_SEC = 0.5


def compute_loop_sleep_sec(
    interval: float,
    elapsed: float,
    last_heartbeat_mono: float,
    now_mono: float,
    heartbeat_interval_sec: float,
    track_heartbeat: bool,
) -> float:
    """Sleep duration before the next loop; cap so overdue heartbeats run immediately."""
    sleep_for = max(0.0, interval - elapsed)
    if not track_heartbeat:
        return sleep_for
    next_heartbeat_in = heartbeat_interval_sec - (now_mono - last_heartbeat_mono)
    if next_heartbeat_in <= 0:
        return 0.0
    return min(sleep_for, next_heartbeat_in)


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


def should_refresh(now_mono: float, last_sync_mono: float, interval_sec: float) -> bool:
    """True when a cached Supabase read should be refreshed."""
    return (now_mono - last_sync_mono) >= interval_sec


def _handle_shutdown(signum: int, _frame: object) -> None:
    global _shutdown_requested
    logger.info("Received signal %s, shutting down...", signum)
    _shutdown_requested = True


def _interruptible_sleep(seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while not _shutdown_requested:
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


def _connect_ibkr(client: IBKRClient, max_attempts: int = 1, delay_sec: float = 2.0) -> bool:
    for attempt in range(1, max_attempts + 1):
        try:
            client.connect()
            return True
        except Exception as exc:
            logger.warning("IBKR connection attempt %s/%s failed: %s", attempt, max_attempts, exc)
            if attempt < max_attempts:
                time.sleep(delay_sec)
    return False


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
) -> None:
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
        _warmup_logged.discard(symbol)
    if new_symbols:
        logger.info(
            "Watchlist expanded — seeded 1-min bars for: %s",
            ", ".join(new_symbols),
        )


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


def _resolve_effective_capital(
    ibkr: IBKRClient,
    account_capital: float,
    trading_mode: TradingMode,
    *,
    equity_divergence_alert_frac: float = 0.05,
    notifier=None,
    divergence_alerted_dates: Optional[set] = None,
) -> tuple[float, str]:
    """Return sizing_capital for RiskManager.

    Paper: always account_capital (never IBKR paper NetLiq).
    Live: min(NetLiquidation, account_capital); alert on large divergence.
    """
    if trading_mode == TradingMode.PAPER:
        return float(account_capital), "USD"

    if ibkr.is_connected():
        try:
            account = ibkr.get_account_summary()
            net_liq = float(account.net_liquidation)
            sizing = min(net_liq, float(account_capital))
            if account_capital > 0 and notifier is not None:
                gap = abs(net_liq - float(account_capital)) / float(account_capital)
                if gap > float(equity_divergence_alert_frac):
                    today = datetime.now(timezone.utc).date()
                    alerted = divergence_alerted_dates if divergence_alerted_dates is not None else set()
                    if today not in alerted:
                        notifier.send(
                            f"Market Pilot equity divergence: NetLiq=${net_liq:.2f} "
                            f"account_capital=${account_capital:.2f} "
                            f"({gap:.1%} > {equity_divergence_alert_frac:.1%})"
                        )
                        alerted.add(today)
            return sizing, account.currency
        except Exception as exc:
            logger.warning("Could not read IBKR capital: %s", exc)
    return float(account_capital), "USD"


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
            ibkr_positions = ibkr.get_positions()
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
) -> RiskManager:
    if risk_settings is None:
        risk_settings = db.get_risk_settings()
    capital, currency = _resolve_effective_capital(
        ibkr,
        risk_settings.account_capital,
        trading_mode,
        equity_divergence_alert_frac=risk_settings.equity_divergence_alert_frac,
    )
    manager = RiskManager(
        settings=risk_settings,
        trading_mode=trading_mode,
        effective_capital=capital,
        open_trades=db.get_open_trades(),
        daily_realized_pnl=db.get_daily_realized_pnl(),
        total_realized_pnl=db.get_total_realized_pnl(),
        currency=currency,
    )
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


def _log_jev_prediction(prediction, tier: str) -> None:
    logger.info(
        "%s market update",
        prediction.symbol,
    )
    logger.info(
        "Jev  BUY: %.0f%%  HOLD: %.0f%%  SELL: %.0f%%",
        prediction.buy * 100,
        prediction.hold * 100,
        prediction.sell * 100,
    )
    logger.info("Signal: %s", tier)


def run() -> int:
    acquire_trader_lock()
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
        jev_sell_exit_threshold=risk_settings.jev_sell_exit_threshold,
    )
    confirmation_tracker = ConfirmationTracker(strategy_config.confirmation_cycles)
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
        if _connect_ibkr(ibkr, max_attempts=3):
            global _ibkr_market_data_mode
            _ibkr_market_data_mode = ibkr.ensure_market_data_ready(all_symbols)
            logger.info(
                "Connected to IBKR (%s:%s) — market data mode: %s",
                settings.ibkr_host,
                settings.ibkr_port,
                _ibkr_market_data_mode,
            )
            _pulse_bot_status(
                db,
                enabled=bot_control.enabled,
                trading_mode=trading_mode,
                execution_mode=configured_execution_mode,
                ibkr_connected=True,
                jev_connected=False,
            )
            # Core + open positions + dynamic picks — otherwise symbols like JPM
            # (on screener list / held but not always-on core) never get bars.
            open_symbols = [trade.symbol for trade in db.get_open_trades()]
            priority_symbols = list(
                dict.fromkeys(
                    merge_core_watchlist(risk_settings, open_symbols)
                    + resolve_trading_watchlist(risk_settings, open_symbols)
                )
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

            backfill_watchlist_symbols(
                settings,
                bar_store,
                ibkr,
                priority_symbols,
                open_symbols=open_symbols,
                on_progress=_on_backfill_progress,
            )
            for symbol in priority_symbols:
                bar_store.seed_minute_aggregator(
                    minute_bars.get(symbol), symbol
                )
            em_universe: List[str] = []
            if risk_settings.watchlist_dynamic_enabled:
                try:
                    em_universe = _load_em_universe(settings, db)
                    em_scheduler.start_em_backfill(
                        settings,
                        bar_store,
                        ibkr,
                        em_universe,
                        exclude_symbols=priority_symbols,
                    )
                except (FileNotFoundError, ValueError) as exc:
                    logger.warning("EM backfill skipped: %s", exc)
                    em_scheduler.mark_backfill_unavailable()
            else:
                em_scheduler.mark_backfill_unavailable()
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
    notifier = build_notifier_from_env()
    if not notifier.configured():
        logger.warning(
            "Telegram notifier unconfigured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)"
        )
    _equity_divergence_alerted: set = set()
    _eod_entries_cancelled_for_close: Optional[datetime] = None
    _eod_flat_verified_for_close: Optional[datetime] = None

    risk_manager: Optional[RiskManager] = None
    if db:
        risk_manager = _init_risk_manager(db, ibkr, trading_mode, risk_settings)
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
    last_live_bar_flush = 0.0
    last_general_news_refresh = 0.0
    general_news_running = False
    general_news_lock = threading.Lock()
    data_source_label = "ibkr" if ibkr.is_connected() else "mock"

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

    while not _shutdown_requested:
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
                    strategy_config = strategy_config_with_risk_overrides(
                        settings.strategy_config,
                        min_volume_ratio=risk_settings.min_volume_ratio,
                        min_share_price=risk_settings.min_share_price,
                        jev_sell_exit_threshold=risk_settings.jev_sell_exit_threshold,
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
                            scan_universe = load_em_universe(
                                db=db,
                                path=settings.resolved_em_universe_path,
                            )
                            snapshot_symbols = list(
                                dict.fromkeys(
                                    scan_universe + [benchmark_symbol] + open_symbols
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
                _sync_watchlist_symbols(
                    all_symbols,
                    mock,
                    minute_bars,
                    bar_store,
                    settings.data_source,
                )
                if (
                    settings.data_source == DataSource.IBKR
                    and ibkr.is_connected()
                ):
                    ibkr.sync_watchlist_subscriptions(all_symbols)
                if risk_manager:
                    risk_manager.update_settings(risk_settings)
                    capital, currency = _resolve_effective_capital(
                        ibkr,
                        risk_settings.account_capital,
                        trading_mode,
                        equity_divergence_alert_frac=risk_settings.equity_divergence_alert_frac,
                        notifier=notifier,
                        divergence_alerted_dates=_equity_divergence_alerted,
                    )
                    risk_manager.update_capital(capital, currency)

            quotes = _get_quotes(settings, ibkr, mock, all_symbols)
            quotes_by_symbol: Dict[str, Quote] = {q.symbol: q for q in quotes}

            if (
                settings.data_source == DataSource.IBKR
                and ibkr.is_connected()
                and _ibkr_market_data_mode == "unavailable"
            ):
                global _last_market_data_warn
                now_mono = time.monotonic()
                if (now_mono - _last_market_data_warn) >= _MARKET_DATA_WARN_INTERVAL_SEC:
                    priced = sum(
                        1 for quote in quotes if quote.price is not None and quote.price > 0
                    )
                    logger.warning(
                        "IBKR quotes still missing (%s/%s symbols priced) — %s",
                        priced,
                        len(quotes),
                        MARKET_DATA_COMPETING_SESSION_MSG,
                    )
                    _last_market_data_warn = now_mono
                    recovered = ibkr.ensure_market_data_ready(all_symbols, wait_sec=1.0)
                    if recovered != "unavailable":
                        _ibkr_market_data_mode = recovered
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
                for closed_trade in closed:
                    db.close_trade(
                        closed_trade.trade_id,
                        closed_trade.exit_price,
                        closed_trade.exit_time,
                        closed_trade.gross_pnl,
                        closed_trade.net_pnl,
                        exit_reason=closed_trade.reason,
                    )
                    risk_manager.note_symbol_exit(
                        closed_trade.symbol, closed_trade.exit_time
                    )
                    portfolio_dirty = True
                if closed:
                    risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())

                closed_demotion = risk_manager.check_demotion_exits(quotes_by_symbol)
                for closed_trade in closed_demotion:
                    db.close_trade(
                        closed_trade.trade_id,
                        closed_trade.exit_price,
                        closed_trade.exit_time,
                        closed_trade.gross_pnl,
                        closed_trade.net_pnl,
                        exit_reason=closed_trade.reason,
                    )
                    risk_manager.note_symbol_exit(
                        closed_trade.symbol, closed_trade.exit_time
                    )
                    portfolio_dirty = True
                if closed_demotion:
                    risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())

                if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                    if sync_ibkr_exits(ibkr, risk_manager, db):
                        portfolio_dirty = True
                    demotion_exit_symbols = collect_demotion_exit_symbols(
                        risk_manager.open_trades,
                        risk_settings,
                    )
                    if close_ibkr_signal_exits(
                        ibkr,
                        risk_manager,
                        db,
                        max_hold_for_symbol=_max_hold_for_symbol,
                        demotion_exit_symbols=demotion_exit_symbols,
                        fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                    ):
                        portfolio_dirty = True

            if portfolio_dirty and db:
                _sync_portfolio_state(
                    db, ibkr, risk_manager, execution_mode, quotes
                )
                portfolio_dirty = False

            benchmark_symbol = (
                effective_benchmark(risk_settings) if db and risk_settings else "SPY"
            )
            benchmark_minute_bars = minute_bars.get(benchmark_symbol.upper())

            session = get_session_clock()
            if db:
                try:
                    db.update_session_clock(
                        is_open=session.is_open if not session.fail_closed else False,
                        open_at=session.session_open_at,
                        close_at=session.session_close_at,
                        minutes_to_close=session.minutes_to_close,
                        error=session.error,
                        notifier_configured=notifier.configured(),
                    )
                except Exception as exc:
                    logger.warning("Failed to publish session clock: %s", exc)

            # EOD closeout: cancel working entries + flatten every cycle until flat.
            if (
                risk_manager
                and risk_settings
                and in_eod_closeout_window(
                    session.minutes_to_close,
                    risk_settings.eod_closeout_minutes_before_close,
                    enabled=risk_settings.eod_closeout_enabled,
                )
            ):
                close_key = session.session_close_at
                if (
                    execution_mode == ExecutionMode.IBKR
                    and ibkr.is_connected()
                    and close_key is not None
                    and _eod_entries_cancelled_for_close != close_key
                ):
                    try:
                        cancelled = ibkr.cancel_working_entry_orders()
                        if cancelled:
                            logger.info(
                                "EOD cancelled %s working entry order(s)", cancelled
                            )
                        _eod_entries_cancelled_for_close = close_key
                    except Exception as exc:
                        logger.error("EOD cancel working entries failed: %s", exc)

                if flatten_open_positions_eod(
                    ibkr=ibkr if execution_mode == ExecutionMode.IBKR else None,
                    risk_manager=risk_manager,
                    db=db,
                    quotes_by_symbol=quotes_by_symbol,
                    execution_mode_ibkr=execution_mode == ExecutionMode.IBKR,
                    fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                ):
                    portfolio_dirty = True

            if (
                risk_manager
                and risk_settings
                and db
                and in_eod_flat_verify_window(
                    session.minutes_to_close,
                    risk_settings.eod_flat_verify_minutes_before_close,
                )
            ):
                close_key = session.session_close_at
                if close_key is not None and _eod_flat_verified_for_close != close_key:
                    verify_flat_and_alert(
                        risk_manager=risk_manager,
                        notifier=notifier,
                        persist=lambda verified_at, ok, detail: db.update_eod_flat_verify(
                            verified_at=verified_at, ok=ok, detail=detail
                        ),
                    )
                    _eod_flat_verified_for_close = close_key

            entry_block = entries_blocked_by_session(
                minutes_to_close=session.minutes_to_close,
                last_entry_cutoff_minutes=getattr(
                    risk_settings, "last_entry_cutoff_minutes_before_close", 40
                )
                if risk_settings
                else 40,
                session_fail_closed=session.fail_closed
                if settings.data_source == DataSource.IBKR
                else False,
                session_is_open=session.is_open
                if settings.data_source == DataSource.IBKR
                else True,
            )
            if settings.data_source != DataSource.IBKR:
                entry_block = None

            # Session closed / clock error: skip Jev entirely. Last-entry cutoff:
            # still eval open positions for exits, but block new entries later.
            session_allows_jev = True
            if settings.data_source == DataSource.IBKR:
                if session.fail_closed or not session.is_open:
                    session_allows_jev = False

            market_open = session_allows_jev
            if not market_open:
                global _last_closed_market_log
                now_mono = time.monotonic()
                if (now_mono - _last_closed_market_log) >= _CLOSED_MARKET_LOG_INTERVAL_SEC:
                    logger.info(
                        "US session blocked entries (%s) — exits/heartbeat continue",
                        entry_block or "market_closed",
                    )
                    _last_closed_market_log = now_mono

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

            jev_sell_symbols: Set[str] = set()

            if news_service and eval_symbols:
                news_service.refresh_stale(eval_symbols)

            ready_states: List[Tuple[str, MarketState]] = []
            for symbol in eval_symbols:
                quote = quotes_by_symbol.get(symbol)
                if quote is None:
                    continue

                state = build_market_state(
                    quote,
                    minute_bars.get(symbol),
                    benchmark_minute_bars,
                    trend_changes=bar_store.get_trend_changes(symbol),
                    warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
                )
                if state is None:
                    if symbol not in _warmup_logged:
                        logger.debug(
                            "%s warming up — need %s one-minute bars",
                            symbol,
                            strategy_config.warmup_min_1m_bars,
                        )
                        _warmup_logged.add(symbol)
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

            predictions_by_symbol = (
                _fetch_jev_predictions(jev, ready_states, settings.jev_max_workers)
                if jev is not None
                else {}
            )
            if predictions_by_symbol:
                jev_connected_this_cycle = True
                jev_connected = True
            elif ready_states and jev is not None:
                jev_connected = False

            for symbol, state in ready_states:
                prediction = predictions_by_symbol.get(symbol)
                if prediction is None:
                    continue

                try:
                    tier = signal_tier(
                        prediction,
                        risk_settings.signal_record_threshold,
                        risk_settings.minimum_jev_confidence,
                        strategy_config.min_buy_hold_margin,
                    )
                    _log_jev_prediction(prediction, tier)

                    if (
                        risk_manager
                        and is_sell_exit_eligible(
                            prediction, strategy_config.jev_sell_exit_threshold
                        )
                        and risk_manager.can_jev_sell_exit(
                            symbol, quotes_by_symbol, log_skip=True
                        )
                    ):
                        jev_sell_symbols.add(symbol)
                        closed = risk_manager.check_jev_exit(symbol, quotes_by_symbol)
                        if closed and db:
                            db.close_trade(
                                closed.trade_id,
                                closed.exit_price,
                                closed.exit_time,
                                closed.gross_pnl,
                                closed.net_pnl,
                                exit_reason=closed.reason,
                            )
                            risk_manager.note_symbol_exit(closed.symbol, closed.exit_time)
                            portfolio_dirty = True
                            risk_manager.set_daily_realized_pnl(
                                db.get_daily_realized_pnl()
                            )

                    trade_created = False
                    trade_skip_reason: Optional[str] = None
                    eligible = is_trade_eligible(tier)
                    if entry_block:
                        confirmation_tracker.record(symbol, False)
                        trade_skip_reason = entry_block
                        eligible = False
                    elif not eligible:
                        confirmation_tracker.record(symbol, False)
                        trade_skip_reason = trade_skip_reason_from_tier(tier)
                    elif not confirmation_tracker.record(symbol, True):
                        current, required = confirmation_tracker.progress(symbol)
                        trade_skip_reason = f"awaiting_confirmation ({current}/{required})"
                        logger.info(
                            "Filter: awaiting confirmation for %s (%s/%s cycles)",
                            symbol,
                            current,
                            required,
                        )
                        eligible = False

                    if eligible and risk_manager and db:
                        entry_strategy = strategy_config_with_risk_overrides(
                            settings.strategy_config,
                            min_volume_ratio=risk_settings.min_volume_ratio,
                            min_share_price=risk_settings.min_share_price,
                            jev_sell_exit_threshold=risk_settings.jev_sell_exit_threshold,
                        )
                        entry_filter = check_entry_filters(state, entry_strategy)
                        if not entry_filter.passed:
                            trade_skip_reason = entry_filter.reason
                            logger.info(
                                "Filter: rejected %s — %s",
                                symbol,
                                entry_filter.reason,
                            )
                            confirmation_tracker.reset(symbol)
                            eligible = False

                        corr_filter = check_correlation_cap(
                            risk_manager.open_trades, symbol, entry_strategy
                        )
                        if eligible and not corr_filter.passed:
                            trade_skip_reason = corr_filter.reason
                            logger.info(
                                "Filter: rejected %s — %s",
                                symbol,
                                corr_filter.reason,
                            )
                            confirmation_tracker.reset(symbol)
                            eligible = False

                    if eligible and risk_manager and db:
                        decision = risk_manager.evaluate_entry(
                            state, prediction, bot_enabled, quotes_by_symbol
                        )
                        if decision.approved and decision.trade:
                            trade = decision.trade
                            if (
                                execution_mode == ExecutionMode.IBKR
                                and ibkr.is_connected()
                            ):
                                try:
                                    ibkr_skip_reason: Optional[str] = None
                                    now_mono = time.monotonic()
                                    if trade.symbol.upper() in _ibkr_entry_blocked:
                                        ibkr_skip_reason = (
                                            "ibkr_ineligible "
                                            "(no trading permission / KID)"
                                        )
                                    else:
                                        cooldown_until = _ibkr_entry_cooldown_until.get(
                                            trade.symbol, 0.0
                                        )
                                        if now_mono < cooldown_until:
                                            remaining = cooldown_until - now_mono
                                            ibkr_skip_reason = (
                                                f"ibkr_cooldown ({remaining:.0f}s left)"
                                            )
                                        elif ibkr.has_pending_entry_order(trade.symbol):
                                            ibkr_skip_reason = "ibkr_pending_entry_order"
                                        else:
                                            try:
                                                account = ibkr.get_account_summary()
                                                if (
                                                    trade.position_value
                                                    > account.buying_power
                                                ):
                                                    ibkr_skip_reason = (
                                                        "ibkr_insufficient_buying_power "
                                                        f"(need ${trade.position_value:.0f}, "
                                                        f"have ${account.buying_power:.0f})"
                                                    )
                                            except Exception as exc:
                                                logger.warning(
                                                    "Could not verify IBKR buying power "
                                                    "for %s: %s",
                                                    trade.symbol,
                                                    exc,
                                                )

                                    if ibkr_skip_reason:
                                        trade_skip_reason = ibkr_skip_reason
                                        logger.info(
                                            "Skipping %s IBKR entry — %s",
                                            trade.symbol,
                                            ibkr_skip_reason,
                                        )
                                    else:
                                        bracket = ibkr.place_bracket_buy(
                                            trade.symbol,
                                            trade.quantity,
                                            trade.stop_loss,
                                            trade.take_profit,
                                            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                                        )
                                        trade.execution_mode = "ibkr"
                                        trade.entry_price = bracket.fill_price
                                        trade.quantity = bracket.filled_quantity
                                        trade.position_value = (
                                            bracket.fill_price
                                            * bracket.filled_quantity
                                        )
                                        trade.ibkr_parent_order_id = (
                                            bracket.parent_order_id
                                        )
                                        trade.ibkr_sl_order_id = bracket.sl_order_id
                                        trade.ibkr_tp_order_id = bracket.tp_order_id
                                        db.insert_trade(trade)
                                        risk_manager.register_open_trade(trade)
                                        confirmation_tracker.reset(trade.symbol)
                                        trade_created = True
                                        portfolio_dirty = True
                                        logger.info(
                                            "IBKR BUY %s x %.0f @ $%.2f "
                                            "(SL $%.2f / TP $%.2f)",
                                            trade.symbol,
                                            trade.quantity,
                                            trade.entry_price,
                                            trade.stop_loss,
                                            trade.take_profit,
                                        )
                                except Exception as exc:
                                    if is_permanent_ibkr_eligibility_rejection(exc):
                                        blocked = trade.symbol.upper()
                                        _ibkr_entry_blocked.add(blocked)
                                        trade_skip_reason = (
                                            "ibkr_ineligible "
                                            f"(no trading permission / KID: {exc})"
                                        )
                                        logger.error(
                                            "IBKR eligibility block for %s — "
                                            "skipping further entries this session: %s",
                                            blocked,
                                            exc,
                                        )
                                        if is_kid_document_rejection(exc):
                                            try:
                                                updated = db.set_em_universe_tradable(
                                                    blocked, False
                                                )
                                                if updated:
                                                    logger.info(
                                                        "Marked %s untradable in "
                                                        "em_universe (KID rejection)",
                                                        blocked,
                                                    )
                                                else:
                                                    logger.debug(
                                                        "%s not in em_universe — "
                                                        "session block only",
                                                        blocked,
                                                    )
                                            except Exception as db_exc:
                                                logger.warning(
                                                    "Could not mark %s untradable in "
                                                    "em_universe: %s",
                                                    blocked,
                                                    db_exc,
                                                )
                                    else:
                                        trade_skip_reason = f"ibkr_order_failed ({exc})"
                                        _ibkr_entry_cooldown_until[symbol] = (
                                            time.monotonic()
                                            + settings.ibkr_entry_cooldown_sec
                                        )
                                        logger.error(
                                            "IBKR order failed for %s: %s", symbol, exc
                                        )
                                        if "PendingSubmit" in str(exc) or "whyHeld" in str(
                                            exc
                                        ):
                                            logger.error(
                                                "Hint: if orders stay PendingSubmit, disable "
                                                "order confirmations in TWS/Gateway "
                                                "(Global Config → Presets → Confirmations)."
                                            )
                            elif execution_mode == ExecutionMode.IBKR:
                                trade_skip_reason = "ibkr_not_connected"
                                logger.warning(
                                    "Execution mode ibkr but IBKR not connected — skipping %s",
                                    symbol,
                                )
                            else:
                                trade.execution_mode = "simulated"
                                db.insert_trade(trade)
                                risk_manager.register_open_trade(trade)
                                confirmation_tracker.reset(trade.symbol)
                                trade_created = True
                                portfolio_dirty = True
                                logger.info(
                                    "Simulated BUY %s x %.0f @ $%.2f (SL $%.2f / TP $%.2f)",
                                    trade.symbol,
                                    trade.quantity,
                                    trade.entry_price,
                                    trade.stop_loss,
                                    trade.take_profit,
                                )
                        elif not decision.approved:
                            trade_skip_reason = decision.reason
                            logger.info("Risk: rejected %s — %s", symbol, decision.reason)

                    if db:
                        db.insert_prediction(
                            state,
                            prediction,
                            trade_created=trade_created,
                            trade_skip_reason=trade_skip_reason,
                        )
                        logger.info("Prediction stored")

                except Exception as exc:
                    logger.error("Post-Jev processing failed for %s: %s", symbol, exc)

            if (
                jev_sell_symbols
                and risk_manager
                and db
                and execution_mode == ExecutionMode.IBKR
                and ibkr.is_connected()
            ):
                if close_ibkr_signal_exits(
                    ibkr,
                    risk_manager,
                    db,
                    max_hold_minutes=0,
                    jev_sell_symbols=jev_sell_symbols,
                    fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                ):
                    portfolio_dirty = True

            if portfolio_dirty and db:
                _sync_portfolio_state(
                    db, ibkr, risk_manager, execution_mode, quotes
                )
                portfolio_dirty = False

            now = time.monotonic()
            if db and (now - last_heartbeat) >= settings.heartbeat_interval_sec:
                heartbeat_status = BotStatusUpdate(
                    enabled=bot_enabled,
                    trading_mode=trading_mode,
                    ibkr_connected=ibkr.is_connected(),
                    jev_connected=jev_connected_this_cycle or jev_connected,
                    execution_mode=configured_execution_mode,
                    last_error=None,
                )
                account = None
                ibkr_positions = None
                simulated_portfolio = None
                open_trades = None

                if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                    try:
                        account = ibkr.get_account_summary()
                        ibkr_positions = ibkr.get_positions()
                    except Exception as exc:
                        logger.warning("IBKR heartbeat failed: %s", exc)
                elif risk_manager:
                    simulated_portfolio = risk_manager.get_portfolio_snapshot(
                        quotes_by_symbol
                    )
                    open_trades = risk_manager.open_trades

                include_portfolio_history = should_refresh(
                    now,
                    last_portfolio_history,
                    settings.portfolio_history_interval_sec,
                )

                db.write_heartbeat(
                    heartbeat_status,
                    quotes,
                    account=account,
                    ibkr_positions=ibkr_positions,
                    simulated_portfolio=simulated_portfolio,
                    open_trades=open_trades,
                    include_portfolio_history=include_portfolio_history,
                    include_market_snapshots=settings.market_snapshots_enabled,
                )
                if include_portfolio_history:
                    last_portfolio_history = now

                heartbeat_equity = None
                if account is not None:
                    heartbeat_equity = account.net_liquidation
                if heartbeat_equity is None and risk_manager is not None:
                    snapshot = simulated_portfolio or risk_manager.get_portfolio_snapshot(
                        quotes_by_symbol
                    )
                    heartbeat_equity = snapshot.equity
                if heartbeat_equity is not None and heartbeat_equity > 0:
                    db.maybe_advance_risk_baseline(
                        heartbeat_equity,
                        threshold=settings.risk_sync_threshold_pct,
                    )

                logger.info("Heartbeat written to Supabase")
                last_heartbeat = now

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
        if sleep_for > 0 and not _shutdown_requested:
            _interruptible_sleep(sleep_for)

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
