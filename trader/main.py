from __future__ import annotations

import logging
import signal
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
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
from broker.reconcile import reconcile_cycle
from broker.symbol_locks import EXIT_LOCKS
from config import Settings, load_settings
from risk.halts import RiskHaltCoordinator
from risk.config_version import fingerprint_risk_settings
from risk.execution_log import compute_long_slippage, update_excursions
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
from market.live_1m_bars import (
    bars_from_ib_historical,
    diff_live_vs_historical,
    drop_forming_bar,
    sync_trade_bars_into_store,
)
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
from strategy.data_gates import (
    EntryKillSwitch,
    JevTransportKillTracker,
    check_quote_fresh_for_symbol,
    classify_jev_error,
    feed_stale_share,
    filter_news_for_jev_context,
    quote_age_sec,
)
from strategy.filters import check_correlation_cap, check_entry_filters
from strategy.pre_submit import pre_submit_recheck
from strategy.signals import (
    is_sell_exit_eligible,
    is_trade_eligible,
    should_spread_veto,
    signal_tier,
    trade_skip_reason_from_tier,
)
from risk.model_drift import ModelDriftTracker
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
        daily_realized_pnl=db.get_daily_realized_pnl(
            include_fees=bool(
                getattr(risk_settings, "daily_loss_include_fees", False)
            )
        ),
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
    *,
    transport_tracker: Optional[JevTransportKillTracker] = None,
    samples: int = 1,
) -> Dict[str, JevPrediction]:
    """Call Jev in parallel so one slow symbol does not block the watchlist.

    Worst-case cycle delay ≈ timeout × attempts per worker (not × symbol count).
    When samples > 1, each symbol runs K sequential calls inside its worker.
    """
    if not ready_states:
        return {}

    workers = min(max_workers, len(ready_states))
    predictions: Dict[str, JevPrediction] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(jev.predict, state, samples=samples): symbol
            for symbol, state in ready_states
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                predictions[symbol] = future.result()
                if transport_tracker is not None:
                    transport_tracker.record(transport_failure=False)
            except Exception as exc:
                logger.error("Jev prediction failed for %s: %s", symbol, exc)
                if transport_tracker is not None:
                    kind = classify_jev_error(exc)
                    transport_tracker.record(transport_failure=(kind == "transport"))
    return predictions


def _resolve_jev_request_model(settings, risk_settings: RiskSettings) -> str:
    pin = getattr(risk_settings, "jev_model_pin", None)
    if pin:
        return str(pin).strip()
    return str(settings.jev_model)

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
    confirmation_tracker = ConfirmationTracker(
        risk_settings.confirmation_count,
        mode=risk_settings.confirmation_mode,
    )
    entry_kill = EntryKillSwitch(active=True, reason="startup")
    jev_transport_kill = JevTransportKillTracker(
        window_sec=float(risk_settings.jev_transport_fail_window_sec),
        kill_frac=float(risk_settings.jev_transport_fail_rate_kill_frac),
    )
    # Completed trade-bar timestamps per symbol for distinct_bars confirmation.
    last_completed_bar_ts: Dict[str, datetime] = {}
    trade_bar_symbols: Set[str] = set()
    logger.info(
        "Strategy filters: min confidence from settings, margin %.0f%%, "
        "confirmation %sx (%s), max hold %.0fm (dashboard), min hold %.0fm, "
        "Jev SELL exit >= %.0f%%, min volume ratio %.2f, "
        "min share price $%.2f (dashboard); entry kill ON until gates green",
        strategy_config.min_buy_hold_margin * 100,
        risk_settings.confirmation_count,
        risk_settings.confirmation_mode,
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
            # max_retries is attempt count; settings store retry extras (1 retry => 2 attempts).
            requested_model = _resolve_jev_request_model(settings, risk_settings)
            jev = JevClient(
                api_key=settings.typesafe_ai_api_key,
                model=requested_model,
                timeout_sec=float(risk_settings.jev_timeout_sec),
                max_retries=max(1, int(risk_settings.jev_max_retries) + 1),
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
                "Connected to IBKR (%s:%s) — market data mode: %s (type=%s)",
                settings.ibkr_host,
                settings.ibkr_port,
                _ibkr_market_data_mode,
                ibkr.market_data_type,
            )
            if ibkr.market_data_type != 1:
                logger.warning(
                    "IBKR marketDataType=%s — prefer type 1 (real-time) for live trading",
                    ibkr.market_data_type,
                )
            ibkr.sync_1m_trade_bar_subscriptions(all_symbols)
            trade_bar_symbols = {s.upper() for s in all_symbols}
            for symbol in all_symbols:
                raw = ibkr.get_1m_trade_bars_raw(symbol)
                if raw:
                    bar = sync_trade_bars_into_store(minute_bars, symbol, raw)
                    if bar is not None:
                        last_completed_bar_ts[symbol.upper()] = bar.ts
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
    model_drift = ModelDriftTracker()
    _eod_entries_cancelled_for_close: Optional[datetime] = None
    _eod_flat_verified_for_close: Optional[datetime] = None
    _eod_bar_audit_for_close: Optional[datetime] = None
    _ibkr_was_connected = ibkr.is_connected()
    _reconcile_block_entries = False

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
            startup_reconcile = reconcile_cycle(
                ibkr,
                risk_manager,
                db,
                trading_mode,
                risk_settings,
                notifier=lambda msg: notifier.send(msg),
                fill_timeout_sec=settings.ibkr_fill_timeout_sec,
            )
            db.update_reconcile_status(
                ok=startup_reconcile.ok and not startup_reconcile.block_entries,
                detail=startup_reconcile.detail,
            )
            _reconcile_block_entries = startup_reconcile.block_entries
            if startup_reconcile.block_entries:
                entry_kill.activate(
                    "reconcile_mismatch", datetime.now(timezone.utc)
                )
            logger.info(
                "Startup reconciliation — adopted=%s protected=%s flattened=%s "
                "attached=%s mismatches=%s ok=%s block_entries=%s",
                startup_reconcile.adopted,
                startup_reconcile.protected,
                startup_reconcile.flattened,
                startup_reconcile.attached_legs,
                startup_reconcile.qty_mismatches,
                startup_reconcile.ok,
                startup_reconcile.block_entries,
            )
            if (
                startup_reconcile.adopted
                or startup_reconcile.protected
                or startup_reconcile.flattened
                or startup_reconcile.attached_legs
            ):
                _sync_portfolio_state(db, ibkr, risk_manager, execution_mode, [])

    risk_halt = RiskHaltCoordinator()
    # Declared early so startup fingerprint and settings sync share the same binding.
    config_id: Optional[str] = None
    if db and risk_manager:
        risk_halt.hydrate(db)
        try:
            cfg_hash, cfg_body = fingerprint_risk_settings(risk_settings)
            config_id = db.ensure_config_version(cfg_hash, cfg_body)
        except Exception as exc:
            logger.warning("config_version fingerprint failed: %s", exc)

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
    last_quote_age_log = 0.0
    last_reconcile = startup_mono
    last_forward_return = startup_mono
    gates_enforce_after_mono = startup_mono + float(
        max(0, risk_settings.quote_age_log_only_sec)
    )
    general_news_running = False
    general_news_lock = threading.Lock()
    data_source_label = "ibkr" if ibkr.is_connected() else "mock"

    def _apply_reconcile_result(result) -> None:
        nonlocal _reconcile_block_entries
        if db is None:
            return
        db.update_reconcile_status(
            ok=result.ok and not result.block_entries,
            detail=result.detail,
        )
        _reconcile_block_entries = bool(result.block_entries)
        now_utc_r = datetime.now(timezone.utc)
        if result.block_entries:
            changed = entry_kill.activate("reconcile_mismatch", now_utc_r)
            if changed and entry_kill.should_alert(
                now_utc_r, float(risk_settings.kill_alert_min_gap_sec)
            ):
                entry_kill.mark_alerted(now_utc_r)
                notifier.send(
                    f"Market Pilot ENTRY KILL ON: reconcile_mismatch ({result.detail})"
                )
        elif entry_kill.active and entry_kill.reason == "reconcile_mismatch":
            entry_kill.active = False
            entry_kill.reason = ""
            entry_kill.activated_at = None
            entry_kill.healthy_since = None
            if entry_kill.should_alert(
                now_utc_r, float(risk_settings.kill_alert_min_gap_sec)
            ):
                entry_kill.mark_alerted(now_utc_r)
                notifier.send("Market Pilot ENTRY KILL cleared — reconcile ok")

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
                    try:
                        cfg_hash, cfg_body = fingerprint_risk_settings(risk_settings)
                        config_id = db.ensure_config_version(cfg_hash, cfg_body)
                    except Exception as exc:
                        logger.warning("config_version refresh failed: %s", exc)
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
                    ibkr.sync_1m_trade_bar_subscriptions(all_symbols)
                    trade_bar_symbols = {s.upper() for s in all_symbols}
                if risk_manager:
                    risk_manager.update_settings(risk_settings)
                    confirmation_tracker.configure(
                        risk_settings.confirmation_count,
                        risk_settings.confirmation_mode,
                    )
                    jev_transport_kill.window_sec = float(
                        risk_settings.jev_transport_fail_window_sec
                    )
                    jev_transport_kill.kill_frac = float(
                        risk_settings.jev_transport_fail_rate_kill_frac
                    )
                    if jev is not None:
                        jev.timeout_sec = float(risk_settings.jev_timeout_sec)
                        jev.max_retries = max(1, int(risk_settings.jev_max_retries) + 1)
                        jev.model = _resolve_jev_request_model(settings, risk_settings)
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

            # Phase 6: update MAE/MFE on open trades from latest marks.
            if risk_manager and db:
                for trade in list(risk_manager.open_trades):
                    quote = quotes_by_symbol.get(trade.symbol)
                    if quote is None or quote.price is None:
                        continue
                    new_mae, new_mfe = update_excursions(
                        entry_price=trade.entry_price,
                        mark_price=float(quote.price),
                        mae=trade.mae,
                        mfe=trade.mfe,
                    )
                    if trade.mae != new_mae or trade.mfe != new_mfe:
                        trade.mae = new_mae
                        trade.mfe = new_mfe
                        try:
                            db.update_trade_excursions(
                                trade.id, mae=new_mae, mfe=new_mfe
                            )
                        except Exception as exc:
                            logger.debug(
                                "MAE/MFE update failed for %s: %s", trade.symbol, exc
                            )

            # Resubscribe keepUpToDate bars after IBKR reconnect; re-run reconcile.
            if settings.data_source == DataSource.IBKR:
                connected_now = ibkr.is_connected()
                just_reconnected = False
                if connected_now and not _ibkr_was_connected:
                    logger.info("IBKR reconnected — resubscribing 1m TRADES bars")
                    ibkr.sync_watchlist_subscriptions(all_symbols)
                    ibkr.sync_1m_trade_bar_subscriptions(all_symbols)
                    trade_bar_symbols = {s.upper() for s in all_symbols}
                    _ibkr_market_data_mode = ibkr.ensure_market_data_ready(
                        all_symbols, wait_sec=1.0
                    )
                    just_reconnected = True
                elif (
                    not connected_now
                    and _ibkr_was_connected
                    and _connect_ibkr(ibkr, max_attempts=1)
                ):
                    logger.info("IBKR reconnect attempt succeeded — resubscribing bars")
                    ibkr.sync_watchlist_subscriptions(all_symbols)
                    ibkr.sync_1m_trade_bar_subscriptions(all_symbols)
                    trade_bar_symbols = {s.upper() for s in all_symbols}
                    _ibkr_market_data_mode = ibkr.ensure_market_data_ready(
                        all_symbols, wait_sec=1.0
                    )
                    just_reconnected = True
                _ibkr_was_connected = ibkr.is_connected()
                if (
                    just_reconnected
                    and execution_mode == ExecutionMode.IBKR
                    and risk_manager
                    and db
                    and ibkr.is_connected()
                ):
                    _apply_reconcile_result(
                        reconcile_cycle(
                            ibkr,
                            risk_manager,
                            db,
                            trading_mode,
                            risk_settings,
                            notifier=lambda msg: notifier.send(msg),
                            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                        )
                    )
                    last_reconcile = time.monotonic()
                    portfolio_dirty = True

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
                        # Resubscribe keepUpToDate 1m bars after market-data recovery.
                        ibkr.sync_1m_trade_bar_subscriptions(all_symbols)
                        trade_bar_symbols = {s.upper() for s in all_symbols}
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

            # Periodic IBKR reconcile (paper/IBKR execution only).
            now_mono_rec = time.monotonic()
            reconcile_every = max(15, int(getattr(risk_settings, "reconcile_interval_sec", 60) or 60))
            if (
                execution_mode == ExecutionMode.IBKR
                and risk_manager
                and db
                and ibkr.is_connected()
                and (now_mono_rec - last_reconcile) >= reconcile_every
            ):
                _apply_reconcile_result(
                    reconcile_cycle(
                        ibkr,
                        risk_manager,
                        db,
                        trading_mode,
                        risk_settings,
                        notifier=lambda msg: notifier.send(msg),
                        fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                    )
                )
                last_reconcile = now_mono_rec
                portfolio_dirty = True

            # Phase 5: daily-loss / drawdown risk halt evaluation.
            if risk_manager and db:
                equity_now: Optional[float] = None
                try:
                    if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                        equity_now = ibkr.get_account_summary().net_liquidation
                    else:
                        equity_now = risk_manager.get_portfolio_snapshot(
                            quotes_by_symbol
                        ).equity
                except Exception as exc:
                    logger.debug("Equity for risk halt unavailable: %s", exc)
                history_hw = None
                try:
                    history_hw = db.get_portfolio_equity_high_water()
                except Exception as exc:
                    logger.debug("portfolio high-water unavailable: %s", exc)
                halt_result = risk_halt.evaluate(
                    risk_manager=risk_manager,
                    risk_settings=risk_settings,
                    db=db,
                    quotes_by_symbol=quotes_by_symbol,
                    equity=equity_now,
                    history_high_water=history_hw,
                    notifier=lambda msg: notifier.send(msg),
                )
                if halt_result.flatten_requested:
                    if flatten_open_positions_eod(
                        ibkr=ibkr if execution_mode == ExecutionMode.IBKR else None,
                        risk_manager=risk_manager,
                        db=db,
                        quotes_by_symbol=quotes_by_symbol,
                        execution_mode_ibkr=execution_mode == ExecutionMode.IBKR,
                        fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                    ):
                        portfolio_dirty = True
                        logger.warning(
                            "Risk halt flatten applied (%s)",
                            halt_result.state.halt_type,
                        )
                if halt_result.newly_tripped:
                    logger.warning(
                        "Risk halt tripped type=%s daily_pnl=%.2f drawdown_frac=%.3f",
                        halt_result.state.halt_type,
                        halt_result.state.daily_pnl,
                        halt_result.state.drawdown_frac,
                    )

            for quote in quotes:
                # Universe scan still uses tick-built bars; entry symbols use keepUpToDate.
                if quote.symbol.upper() not in trade_bar_symbols:
                    minute_bars.record(quote)

            # Refresh completed 1m TRADES bars (no historical poll — subscription update).
            now_utc = datetime.now(timezone.utc)
            if (
                settings.data_source == DataSource.IBKR
                and ibkr.is_connected()
                and trade_bar_symbols
            ):
                session_for_bars = get_session_clock(now_utc)
                for symbol in list(trade_bar_symbols):
                    raw = ibkr.get_1m_trade_bars_raw(symbol)
                    if not raw:
                        continue
                    bar = sync_trade_bars_into_store(
                        minute_bars,
                        symbol,
                        raw,
                        session_open=session_for_bars.session_open_at,
                        session_close=session_for_bars.session_close_at,
                        now=now_utc,
                    )
                    if bar is not None:
                        prev = last_completed_bar_ts.get(symbol)
                        if prev is not None and bar.ts > prev:
                            # Gap detection for confirmation reset
                            gap = (bar.ts - prev).total_seconds()
                            if gap > float(risk_settings.max_bar_gap_sec):
                                confirmation_tracker.record(
                                    symbol, False, missed_bar=True
                                )
                        last_completed_bar_ts[symbol] = bar.ts

            # Quote-age feed kill + per-symbol staleness (log distributions first).
            ages: list[float] = []
            ages_opt: list[Optional[float]] = []
            for quote in quotes:
                age = quote_age_sec(
                    now=now_utc,
                    received_at=quote.received_at,
                    exchange_at=quote.exchange_at,
                )
                ages_opt.append(age)
                if age is not None:
                    ages.append(age)
            entry_kill.note_ages(ages)
            p50, p95 = entry_kill.age_percentiles()
            now_mono_age = time.monotonic()
            if ages and (now_mono_age - last_quote_age_log) >= 30.0:
                logger.info(
                    "Quote age distribution n=%s p50=%.2fs p95=%.2fs enforce=%s",
                    len(ages),
                    p50 or -1,
                    p95 or -1,
                    now_mono_age >= gates_enforce_after_mono,
                )
                last_quote_age_log = now_mono_age

            feed_share = feed_stale_share(
                ages_opt, float(risk_settings.kill_stale_quote_sec)
            )
            md_type = ibkr.market_data_type if ibkr.is_connected() else None
            feed_unhealthy = False
            feed_reason = ""
            enforce_gates = (
                risk_settings.stale_input_gates_enabled
                and time.monotonic() >= gates_enforce_after_mono
            )
            if enforce_gates:
                if md_type is not None and md_type != 1 and settings.data_source == DataSource.IBKR:
                    feed_unhealthy = True
                    feed_reason = f"market_data_type_{md_type}"
                if feed_share >= float(risk_settings.kill_stale_quote_share_frac):
                    feed_unhealthy = True
                    feed_reason = feed_reason or "stale_quote_share"
                if (
                    settings.data_source == DataSource.IBKR
                    and not ibkr.is_connected()
                ):
                    feed_unhealthy = True
                    feed_reason = "ibkr_disconnected"

            if feed_unhealthy:
                entry_kill.observe_unhealthy()
                changed = entry_kill.activate(feed_reason or "feed_unhealthy", now_utc)
                if changed and entry_kill.should_alert(
                    now_utc, float(risk_settings.kill_alert_min_gap_sec)
                ):
                    entry_kill.mark_alerted(now_utc)
                    notifier.send(
                        f"Market Pilot ENTRY KILL ON: {entry_kill.reason} "
                        f"(stale_share={feed_share:.0%})"
                    )
            elif entry_kill.reason != "reconcile_mismatch":
                # Sticky reconcile_mismatch clears only via successful reconcile.
                cleared = entry_kill.observe_healthy(
                    now_utc, float(risk_settings.kill_recover_healthy_sec)
                )
                if cleared and entry_kill.should_alert(
                    now_utc, float(risk_settings.kill_alert_min_gap_sec)
                ):
                    entry_kill.mark_alerted(now_utc)
                    notifier.send("Market Pilot ENTRY KILL cleared — gates healthy")

            if enforce_gates and jev_transport_kill.should_kill(now_utc):
                changed = entry_kill.activate("jev_transport", now_utc)
                if changed and entry_kill.should_alert(
                    now_utc, float(risk_settings.kill_alert_min_gap_sec)
                ):
                    entry_kill.mark_alerted(now_utc)
                    notifier.send(
                        f"Market Pilot ENTRY KILL ON: jev_transport "
                        f"(fail_rate={jev_transport_kill.failure_rate(now_utc):.0%})"
                    )
            # Sticky reconcile block wins over feed recovery / takes priority after other kills.
            if (
                _reconcile_block_entries
                and entry_kill.reason != "reconcile_mismatch"
                and not feed_unhealthy
            ):
                entry_kill.activate("reconcile_mismatch", now_utc)

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

            # EOD: re-fetch 1m TRADES history and diff vs stored live bars (once per close).
            if (
                settings.data_source == DataSource.IBKR
                and ibkr.is_connected()
                and risk_settings
                and in_eod_closeout_window(
                    session.minutes_to_close,
                    risk_settings.eod_closeout_minutes_before_close,
                    enabled=risk_settings.eod_closeout_enabled,
                )
            ):
                close_key = session.session_close_at
                if close_key is not None and _eod_bar_audit_for_close != close_key:
                    audit_symbols = sorted(trade_bar_symbols) or list(all_symbols)
                    for symbol in audit_symbols:
                        try:
                            hist_raw = ibkr.fetch_1m_trades_snapshot(symbol)
                            hist_bars = drop_forming_bar(
                                bars_from_ib_historical(hist_raw)
                            )
                            live = drop_forming_bar(
                                minute_bars.get(symbol).completed_bars()
                            )
                            summary = diff_live_vs_historical(live, hist_bars)
                            logger.info(
                                "EOD 1m bar audit %s: live=%s hist=%s common=%s "
                                "mismatch=%s missing_live=%s missing_hist=%s "
                                "vol_units_ok=%s avg_close_err_pct=%.4f",
                                symbol,
                                summary["live_bars"],
                                summary["historical_bars"],
                                summary["common_minutes"],
                                summary["mismatched_minutes"],
                                summary["missing_in_live"],
                                summary["missing_in_historical"],
                                summary["volume_units_ok"],
                                summary["avg_close_abs_pct_err"] * 100,
                            )
                        except Exception as exc:
                            logger.warning("EOD 1m bar audit failed for %s: %s", symbol, exc)
                    _eod_bar_audit_for_close = close_key

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

            halt_reason = risk_halt.entry_blocked()
            if halt_reason and entry_block is None:
                entry_block = halt_reason

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

            # Reset confirmation for symbols that left the effective watchlist.
            open_for_reset = (
                [t.symbol for t in risk_manager.open_trades] if risk_manager else []
            )
            confirmation_tracker.reset_symbols_not_in(
                set(eval_symbols) | {s.upper() for s in open_for_reset}
            )

            ready_states: List[Tuple[str, MarketState]] = []
            stale_symbol_skip: Dict[str, str] = {}
            for symbol in eval_symbols:
                quote = quotes_by_symbol.get(symbol)
                if quote is None:
                    continue

                if risk_settings.stale_input_gates_enabled:
                    age = quote_age_sec(
                        now=datetime.now(timezone.utc),
                        received_at=quote.received_at,
                        exchange_at=quote.exchange_at,
                    )
                    qgate = check_quote_fresh_for_symbol(
                        age,
                        float(risk_settings.max_quote_age_sec),
                        enforce=True,
                    )
                    if not qgate.passed:
                        stale_symbol_skip[symbol] = qgate.reason
                        confirmation_tracker.record(symbol, False)
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

                # Newly ranked names must be seeded via keepUpToDate before entry-eligible.
                if (
                    settings.data_source == DataSource.IBKR
                    and symbol.upper() in trade_bar_symbols
                    and minute_bars.get(symbol).bar_count()
                    < strategy_config.warmup_min_1m_bars
                ):
                    continue

                logger.info(
                    "%s  $%.2f  (%s)",
                    symbol,
                    state.price,
                    data_source_label,
                )

                if jev is None:
                    continue

                enriched = enrich_market_state_with_news(state, news_service)
                # Stale news: drop from Jev context; stale negatives still veto later.
                if enriched.news_articles:
                    fresh_articles, stale_negs = filter_news_for_jev_context(
                        enriched.news_articles,
                        now=datetime.now(timezone.utc),
                        max_pub_age_sec=float(risk_settings.max_news_pub_age_sec),
                        max_receipt_lag_sec=float(
                            risk_settings.max_news_receipt_lag_sec
                        ),
                    )
                    from dataclasses import replace as dc_replace

                    enriched = dc_replace(
                        enriched,
                        news_articles=fresh_articles or None,
                        news_headline_count=len(fresh_articles) if fresh_articles else 0,
                    )
                    if stale_negs:
                        # Keep a marker for veto without putting stale text into Jev.
                        enriched = dc_replace(
                            enriched,
                            news_sentiment=min(
                                float(enriched.news_sentiment or 0), -0.5
                            ),
                            news_tags=list(
                                dict.fromkeys(
                                    (enriched.news_tags or [])
                                    + ["stale_negative_headline"]
                                )
                            ),
                        )
                ready_states.append((symbol, enriched))

            predictions_by_symbol = (
                _fetch_jev_predictions(
                    jev,
                    ready_states,
                    settings.jev_max_workers,
                    transport_tracker=jev_transport_kill,
                    samples=int(getattr(risk_settings, "jev_samples", 1) or 1),
                )
                if jev is not None
                else {}
            )
            if predictions_by_symbol:
                jev_connected_this_cycle = True
                jev_connected = True
                if jev is not None:
                    for pred in predictions_by_symbol.values():
                        model_drift.check(
                            requested=jev.model,
                            returned=pred.model,
                            notifier=notifier,
                        )
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
                        gate_field=getattr(
                            risk_settings, "jev_gate_field", "buy_probability"
                        ),
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
                    skip_reasons: List[str] = []
                    eligible = is_trade_eligible(tier)

                    def _note_skip(reason: Optional[str]) -> None:
                        nonlocal trade_skip_reason
                        if not reason:
                            return
                        if reason not in skip_reasons:
                            skip_reasons.append(reason)
                        if trade_skip_reason is None:
                            trade_skip_reason = reason

                    if (
                        eligible
                        and should_spread_veto(
                            prediction,
                            enabled=bool(
                                getattr(risk_settings, "jev_spread_veto_enabled", False)
                            ),
                            max_stddev=float(
                                getattr(risk_settings, "jev_spread_max_stddev", 0.05)
                            ),
                        )
                    ):
                        _note_skip("jev_spread_veto")
                        eligible = False

                    if entry_kill.active:
                        confirmation_tracker.record(symbol, False)
                        _note_skip(f"entry_kill ({entry_kill.reason or 'active'})")
                        eligible = False
                    elif entry_block:
                        confirmation_tracker.record(symbol, False)
                        _note_skip(entry_block)
                        eligible = False
                    elif not eligible:
                        confirmation_tracker.record(symbol, False)
                        if trade_skip_reason is None:
                            _note_skip(trade_skip_reason_from_tier(tier))
                    else:
                        # Evaluate confirmation once per newly completed real-volume bar.
                        # Same bar_ts is not double-counted; forward-fill (vol=0) skipped.
                        completed_ts = last_completed_bar_ts.get(symbol.upper())
                        bar_for_confirm = completed_ts
                        agg_bars = minute_bars.get(symbol).completed_bars()
                        if agg_bars:
                            last_bar = agg_bars[-1]
                            if last_bar.volume <= 0:
                                bar_for_confirm = None
                        if not confirmation_tracker.record(
                            symbol,
                            True,
                            completed_bar_ts=bar_for_confirm,
                        ):
                            current, required = confirmation_tracker.progress(symbol)
                            _note_skip(
                                f"awaiting_confirmation ({current}/{required})"
                            )
                            logger.info(
                                "Filter: awaiting confirmation for %s (%s/%s bars)",
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
                            _note_skip(entry_filter.reason)
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
                        if not corr_filter.passed:
                            _note_skip(corr_filter.reason)
                            logger.info(
                                "Filter: rejected %s — %s",
                                symbol,
                                corr_filter.reason,
                            )
                            if eligible:
                                confirmation_tracker.reset(symbol)
                            eligible = False

                    if eligible and risk_manager and db:
                        decision = risk_manager.evaluate_entry(
                            state, prediction, bot_enabled, quotes_by_symbol
                        )
                        if decision.approved and decision.trade:
                            trade = decision.trade
                            # Pre-submit: fresh snapshot, ask sizing, re-run gates + drift.
                            fresh_list = _get_quotes(
                                settings, ibkr, mock, [trade.symbol]
                            )
                            fresh_quote = fresh_list[0] if fresh_list else None
                            pre = pre_submit_recheck(
                                symbol=trade.symbol,
                                decision_price=trade.entry_price,
                                fresh_quote=fresh_quote,
                                risk_manager=risk_manager,
                                risk_settings=risk_settings,
                                bot_enabled=bot_enabled,
                                entry_kill_active=entry_kill.active,
                                entry_block=entry_block,
                                prediction_ts=prediction.timestamp,
                                open_quotes=quotes_by_symbol,
                                risk_halt_reason=risk_halt.entry_blocked(),
                            )
                            if not pre.ok:
                                _note_skip(f"pre_submit_{pre.reason}")
                                logger.info(
                                    "Pre-submit rejected %s — %s",
                                    trade.symbol,
                                    pre.reason,
                                )
                                confirmation_tracker.reset(trade.symbol)
                            else:
                                trade.decision_price = pre.entry_price
                                trade.config_id = config_id
                                trade.entry_price = pre.entry_price
                                trade.quantity = pre.quantity
                                trade.position_value = pre.position_value
                                trade.stop_loss = pre.stop_loss
                                trade.take_profit = pre.take_profit
                                if fresh_quote is not None:
                                    trade.fill_bid = fresh_quote.bid
                                    trade.fill_ask = fresh_quote.ask
                            if trade_skip_reason and trade_skip_reason.startswith(
                                "pre_submit_"
                            ):
                                pass
                            elif (
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
                                        _note_skip(ibkr_skip_reason)
                                        logger.info(
                                            "Skipping %s IBKR entry — %s",
                                            trade.symbol,
                                            ibkr_skip_reason,
                                        )
                                    else:
                                        coid = f"mp-{trade.id}-entry"
                                        trade.client_order_id = coid
                                        with EXIT_LOCKS.hold(trade.symbol):
                                            bracket = ibkr.place_bracket_buy(
                                                trade.symbol,
                                                trade.quantity,
                                                trade.stop_loss,
                                                trade.take_profit,
                                                fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                                                client_order_id=coid,
                                            )
                                            if bracket.resize_failed:
                                                try:
                                                    close = ibkr.close_long_position_safe(
                                                        trade.symbol,
                                                        float(int(bracket.filled_quantity)),
                                                        parent_order_id=bracket.parent_order_id,
                                                        sl_order_id=bracket.sl_order_id,
                                                        tp_order_id=bracket.tp_order_id,
                                                        fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                                                    )
                                                    notifier.send(
                                                        f"Market Pilot flattened {trade.symbol} "
                                                        f"after partial-fill child resize failure "
                                                        f"(filled={bracket.filled_quantity})"
                                                    )
                                                    _note_skip(
                                                        "ibkr_partial_resize_failed_flattened"
                                                    )
                                                    logger.error(
                                                        "Partial fill resize failed for %s — "
                                                        "flattened (fill=$%.2f already_flat=%s)",
                                                        trade.symbol,
                                                        close.fill_price,
                                                        close.already_flat,
                                                    )
                                                except Exception as flatten_exc:
                                                    _note_skip(
                                                        f"ibkr_partial_resize_failed ({flatten_exc})"
                                                    )
                                                    entry_kill.activate(
                                                        "reconcile_mismatch",
                                                        datetime.now(timezone.utc),
                                                    )
                                                    _reconcile_block_entries = True
                                                    notifier.send(
                                                        f"Market Pilot FAILED flatten after "
                                                        f"partial resize on {trade.symbol}: "
                                                        f"{flatten_exc}"
                                                    )
                                                    logger.error(
                                                        "Failed flatten after resize fail %s: %s",
                                                        trade.symbol,
                                                        flatten_exc,
                                                    )
                                            else:
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
                                                trade.client_order_id = (
                                                    bracket.client_order_id or coid
                                                )
                                                trade.slippage = compute_long_slippage(
                                                    decision_price=trade.decision_price,
                                                    fill_price=bracket.fill_price,
                                                    quantity=bracket.filled_quantity,
                                                )
                                                trade.mae = 0.0
                                                trade.mfe = 0.0
                                                db.insert_trade(trade)
                                                risk_manager.register_open_trade(trade)
                                                confirmation_tracker.reset(trade.symbol)
                                                trade_created = True
                                                portfolio_dirty = True
                                                logger.info(
                                                    "IBKR BUY %s x %.0f @ $%.2f "
                                                    "(SL $%.2f / TP $%.2f)%s",
                                                    trade.symbol,
                                                    trade.quantity,
                                                    trade.entry_price,
                                                    trade.stop_loss,
                                                    trade.take_profit,
                                                    (
                                                        " [children resized]"
                                                        if bracket.resized_children
                                                        else ""
                                                    ),
                                                )
                                except Exception as exc:
                                    if is_permanent_ibkr_eligibility_rejection(exc):
                                        blocked = trade.symbol.upper()
                                        _ibkr_entry_blocked.add(blocked)
                                        _note_skip(
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
                                        _note_skip(f"ibkr_order_failed ({exc})")
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
                                _note_skip("ibkr_not_connected")
                                logger.warning(
                                    "Execution mode ibkr but IBKR not connected — skipping %s",
                                    symbol,
                                )
                            else:
                                trade.execution_mode = "simulated"
                                trade.slippage = compute_long_slippage(
                                    decision_price=trade.decision_price,
                                    fill_price=trade.entry_price,
                                    quantity=trade.quantity,
                                )
                                trade.mae = 0.0
                                trade.mfe = 0.0
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
                            _note_skip(decision.reason)
                            logger.info("Risk: rejected %s — %s", symbol, decision.reason)

                    if db:
                        quote = quotes_by_symbol.get(symbol)
                        pred_id = db.insert_prediction(
                            state,
                            prediction,
                            trade_created=trade_created,
                            trade_skip_reason=trade_skip_reason,
                            config_id=config_id,
                            skip_reasons=skip_reasons,
                            decision_bid=quote.bid if quote else None,
                            decision_ask=quote.ask if quote else None,
                        )
                        try:
                            db.insert_decision_log(
                                symbol=symbol,
                                eval_at=prediction.timestamp,
                                outcome=(
                                    "trade_created" if trade_created else "skipped"
                                ),
                                reasons=skip_reasons,
                                config_id=config_id,
                                prediction_id=pred_id,
                                detail={
                                    "buy": prediction.buy,
                                    "hold": prediction.hold,
                                    "sell": prediction.sell,
                                    "confidence": prediction.confidence,
                                    "gate_field": getattr(
                                        risk_settings,
                                        "jev_gate_field",
                                        "buy_probability",
                                    ),
                                    "prob_stddev": prediction.prob_stddev,
                                    "samples_used": prediction.samples_used,
                                    "price": state.price,
                                    "entry_kill": entry_kill.active,
                                    "entry_kill_reason": entry_kill.reason or None,
                                    "risk_halt": risk_halt.state.active,
                                    "risk_halt_reason": risk_halt.state.reason or None,
                                    "model": prediction.model or None,
                                },
                            )
                        except Exception as log_exc:
                            logger.warning(
                                "decision_log insert failed for %s: %s",
                                symbol,
                                log_exc,
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

            # Phase 6: forward returns for predictions past horizon.
            now_mono_fwd = time.monotonic()
            if (
                db
                and (now_mono_fwd - last_forward_return) >= 60.0
            ):
                try:
                    horizon = int(
                        getattr(risk_settings, "prediction_horizon_minutes", 15) or 15
                    )
                    older_than = datetime.now(timezone.utc) - timedelta(minutes=horizon)
                    pending = db.list_predictions_needing_forward_return(
                        older_than=older_than, limit=40
                    )
                    now_fwd = datetime.now(timezone.utc)
                    for row in pending:
                        sym = str(row.get("symbol") or "").upper()
                        quote = quotes_by_symbol.get(sym)
                        if quote is None or quote.price is None or quote.price <= 0:
                            continue
                        signal_price = float(row.get("price") or 0)
                        if signal_price <= 0:
                            continue
                        fwd_price = float(quote.price)
                        fwd_ret = (fwd_price - signal_price) / signal_price
                        raw_ts = row["timestamp"]
                        if isinstance(raw_ts, datetime):
                            signal_at = raw_ts
                        else:
                            signal_at = datetime.fromisoformat(
                                str(raw_ts).replace("Z", "+00:00")
                            )
                        db.insert_signal_forward_return(
                            prediction_id=str(row["id"]),
                            symbol=sym,
                            signal_at=signal_at,
                            signal_price=signal_price,
                            horizon_minutes=horizon,
                            forward_at=now_fwd,
                            forward_price=fwd_price,
                            forward_return=fwd_ret,
                        )
                except Exception as exc:
                    logger.debug("forward-return job failed: %s", exc)
                last_forward_return = now_mono_fwd

            now = time.monotonic()
            if db and (now - last_heartbeat) >= settings.heartbeat_interval_sec:
                heartbeat_status = BotStatusUpdate(
                    enabled=bot_enabled,
                    trading_mode=trading_mode,
                    ibkr_connected=ibkr.is_connected(),
                    jev_connected=jev_connected_this_cycle or jev_connected,
                    execution_mode=configured_execution_mode,
                    last_error=None,
                    entry_kill_active=entry_kill.active,
                    entry_kill_reason=entry_kill.reason or None,
                    entry_kill_at=entry_kill.activated_at,
                    market_data_type=(
                        ibkr.market_data_type if ibkr.is_connected() else None
                    ),
                    quote_age_p50_sec=entry_kill.age_percentiles()[0],
                    quote_age_p95_sec=entry_kill.age_percentiles()[1],
                    daily_pnl=risk_halt.state.daily_pnl,
                    risk_halt_active=risk_halt.state.active,
                    risk_halt_reason=risk_halt.state.reason or None,
                    last_risk_eval_at=risk_halt.state.last_eval_at,
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

                logger.info(
                    "Risk summary daily_pnl=%.2f unrealized=%.2f halt=%s "
                    "reason=%s drawdown_frac=%.3f",
                    risk_halt.state.daily_pnl,
                    (
                        risk_manager._unrealized_pnl(quotes_by_symbol)
                        if risk_manager
                        else 0.0
                    ),
                    risk_halt.state.active,
                    risk_halt.state.reason or "-",
                    risk_halt.state.drawdown_frac,
                )

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
