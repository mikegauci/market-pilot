from __future__ import annotations

import logging
import signal
import sys
import time
from typing import Dict, Optional, Set

from broker.execution import close_ibkr_signal_exits, sync_ibkr_exits
from broker.ibkr import IBKRClient
from broker.reconcile import reconcile_orphan_ibkr_positions
from config import Settings, load_settings
from instance_lock import acquire_trader_lock
from database.supabase import SupabaseRepository
from jev.client import JevClient
from market.history import HistoryStore
from news.cache import TtlCache
from news.client import FinnhubNewsClient, NewsService
from news.enrich import enrich_market_state_with_news
from news.sentiment import NewsContext
from market.hours import is_us_regular_session_open
from market.indicators import build_market_state
from market.mock import MockMarketProvider
from models.types import (
    BotStatusUpdate,
    DataSource,
    ExecutionMode,
    Quote,
    RiskSettings,
    TradingMode,
)
from risk.manager import RiskManager
from strategy.confirmation import ConfirmationTracker
from strategy.filters import check_correlation_cap, check_entry_filters
from strategy.signals import is_sell_exit_eligible, is_trade_eligible, signal_tier

logger = logging.getLogger(__name__)

_shutdown_requested = False
_warmup_logged: Set[str] = set()
_last_closed_market_log = 0.0
_ibkr_entry_cooldown_until: Dict[str, float] = {}
_CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0
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


def _all_symbols(watchlist: list[str]) -> list[str]:
    return list(dict.fromkeys(watchlist + ["SPY"]))


def _sync_watchlist_symbols(
    all_symbols: list[str],
    mock: MockMarketProvider,
    history: HistoryStore,
    data_source: DataSource,
) -> None:
    """Pick up watchlist changes at runtime without restarting the trader."""
    if data_source != DataSource.MOCK:
        return
    new_symbols = mock.ensure_symbols(all_symbols)
    for symbol in new_symbols:
        mock.seed_symbol_history(history, symbol)
        _warmup_logged.discard(symbol)
    if new_symbols:
        logger.info(
            "Watchlist expanded — seeded mock history for: %s",
            ", ".join(new_symbols),
        )


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
    fallback: float,
) -> tuple[float, str]:
    if ibkr.is_connected():
        try:
            account = ibkr.get_account_summary()
            return account.net_liquidation, account.currency
        except Exception as exc:
            logger.warning("Could not read IBKR capital: %s", exc)
    return fallback, "USD"


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
    capital, currency = _resolve_effective_capital(ibkr, risk_settings.account_capital)
    return RiskManager(
        settings=risk_settings,
        trading_mode=trading_mode,
        effective_capital=capital,
        open_trades=db.get_open_trades(),
        daily_realized_pnl=db.get_daily_realized_pnl(),
        total_realized_pnl=db.get_total_realized_pnl(),
        currency=currency,
    )


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
        "Data source: %s | Execution: %s | Eval interval: %ss",
        settings.data_source.value,
        settings.execution_mode.value,
        settings.eval_interval_sec,
    )

    db: Optional[SupabaseRepository] = None
    try:
        db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as exc:
        logger.error("Supabase initialization failed: %s", exc)
        return 1

    risk_settings = db.get_risk_settings()
    watchlist = risk_settings.watchlist or settings.watchlist_symbols
    all_symbols = _all_symbols(watchlist)

    mock = MockMarketProvider(all_symbols)
    history = HistoryStore(all_symbols)
    if settings.data_source == DataSource.MOCK:
        mock.seed_history(history)
        logger.info("Seeded mock price history for indicators")
    elif settings.data_source == DataSource.IBKR:
        logger.info(
            "Using IBKR quotes to build indicator history (warm-up ~%.0fs)",
            settings.strategy_config.warmup_min_span_sec,
        )

    strategy_config = settings.strategy_config
    confirmation_tracker = ConfirmationTracker(strategy_config.confirmation_cycles)
    logger.info(
        "Strategy filters: min confidence from settings, margin %.0f%%, "
        "confirmation %sx, max hold %.0fm (dashboard)",
        strategy_config.min_buy_hold_margin * 100,
        strategy_config.confirmation_cycles,
        risk_settings.max_hold_minutes,
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
            "News enrichment enabled (Finnhub, cache TTL %.0fs, skip %s)",
            settings.news_cache_ttl_sec,
            ", ".join(sorted(settings.news_skip_symbol_set)) or "none",
        )
    elif settings.data_source == DataSource.MOCK:
        logger.info("News enrichment skipped in mock data mode")

    if settings.data_source == DataSource.IBKR:
        if _connect_ibkr(ibkr, max_attempts=3):
            ibkr.subscribe_watchlist(all_symbols)
            logger.info("Connected to IBKR (%s:%s)", settings.ibkr_host, settings.ibkr_port)
        else:
            logger.warning("IBKR unavailable — falling back to mock market data")
    else:
        logger.info("Using mock market data (IBKR not required)")

    bot_control = db.get_bot_control(settings.execution_mode)
    trading_mode = bot_control.trading_mode
    execution_mode = bot_control.execution_mode
    risk_manager: Optional[RiskManager] = None
    if db:
        risk_manager = _init_risk_manager(db, ibkr, trading_mode, risk_settings)
        if execution_mode != settings.execution_mode:
            logger.info(
                "Execution mode from dashboard: %s (env default: %s)",
                execution_mode.value,
                settings.execution_mode.value,
            )
        logger.info(
            "Risk engine loaded — %s open simulated trades, capital $%.2f",
            len(risk_manager.open_trades),
            risk_manager.effective_capital,
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
    last_heartbeat = 0.0
    data_source_label = "ibkr" if ibkr.is_connected() else "mock"

    while not _shutdown_requested:
        loop_start = time.monotonic()
        jev_connected_this_cycle = False
        market_open = True
        portfolio_dirty = False

        try:
            if db:
                bot_control = db.get_bot_control(settings.execution_mode)
                bot_enabled = bot_control.enabled
                trading_mode = bot_control.trading_mode
                execution_mode = bot_control.execution_mode
                risk_settings = db.get_risk_settings()
                watchlist = risk_settings.watchlist or settings.watchlist_symbols
                open_symbols = (
                    [t.symbol for t in risk_manager.open_trades]
                    if risk_manager
                    else []
                )
                all_symbols = _all_symbols(
                    list(dict.fromkeys(watchlist + open_symbols))
                )
                _sync_watchlist_symbols(
                    all_symbols, mock, history, settings.data_source
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
                    )
                    risk_manager.update_capital(capital, currency)

            quotes = _get_quotes(settings, ibkr, mock, all_symbols)
            quotes_by_symbol: Dict[str, Quote] = {q.symbol: q for q in quotes}

            for quote in quotes:
                history.record(quote)

            if risk_manager and db:
                closed = risk_manager.check_exits(
                    quotes_by_symbol,
                    max_hold_minutes=risk_settings.max_hold_minutes,
                )
                for closed_trade in closed:
                    db.close_trade(
                        closed_trade.trade_id,
                        closed_trade.exit_price,
                        closed_trade.exit_time,
                        closed_trade.gross_pnl,
                        closed_trade.net_pnl,
                    )
                    portfolio_dirty = True
                if closed:
                    risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())

                if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                    if sync_ibkr_exits(ibkr, risk_manager, db):
                        portfolio_dirty = True
                    if close_ibkr_signal_exits(
                        ibkr,
                        risk_manager,
                        db,
                        max_hold_minutes=risk_settings.max_hold_minutes,
                        fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                    ):
                        portfolio_dirty = True

            if portfolio_dirty and db:
                _sync_portfolio_state(
                    db, ibkr, risk_manager, execution_mode, quotes
                )
                portfolio_dirty = False

            spy_history = history.get("SPY")

            market_open = (
                settings.data_source != DataSource.IBKR or is_us_regular_session_open()
            )
            if not market_open:
                global _last_closed_market_log
                now_mono = time.monotonic()
                if (now_mono - _last_closed_market_log) >= _CLOSED_MARKET_LOG_INTERVAL_SEC:
                    logger.info(
                        "US market closed — skipping Jev (exits/heartbeat continue)"
                    )
                    _last_closed_market_log = now_mono

            eval_symbols: list[str] = []
            if market_open:
                open_symbols = (
                    [t.symbol for t in risk_manager.open_trades]
                    if risk_manager
                    else []
                )
                eval_symbols = list(dict.fromkeys(watchlist + open_symbols))

            jev_sell_symbols: Set[str] = set()

            if news_service and eval_symbols:
                news_service.refresh_stale(eval_symbols)

            for symbol in eval_symbols:
                quote = quotes_by_symbol.get(symbol)
                if quote is None:
                    continue

                state = build_market_state(
                    quote,
                    history,
                    spy_history,
                    warmup_min_samples=strategy_config.warmup_min_samples,
                    warmup_min_span_sec=strategy_config.warmup_min_span_sec,
                )
                if state is None:
                    if symbol not in _warmup_logged:
                        logger.debug("%s warming up — need more price history", symbol)
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

                state = enrich_market_state_with_news(state, news_service)

                try:
                    prediction = jev.predict(state)
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
                        and any(t.symbol == symbol for t in risk_manager.open_trades)
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
                            )
                            portfolio_dirty = True
                            risk_manager.set_daily_realized_pnl(
                                db.get_daily_realized_pnl()
                            )

                    trade_created = False
                    eligible = is_trade_eligible(tier)
                    if eligible and not confirmation_tracker.record(symbol, True):
                        current, required = confirmation_tracker.progress(symbol)
                        logger.info(
                            "Filter: awaiting confirmation for %s (%s/%s cycles)",
                            symbol,
                            current,
                            required,
                        )
                        eligible = False
                    elif not eligible:
                        confirmation_tracker.record(symbol, False)

                    if eligible and risk_manager and db:
                        entry_filter = check_entry_filters(state, strategy_config)
                        if not entry_filter.passed:
                            logger.info(
                                "Filter: rejected %s — %s",
                                symbol,
                                entry_filter.reason,
                            )
                            confirmation_tracker.reset(symbol)
                            eligible = False

                        corr_filter = check_correlation_cap(
                            risk_manager.open_trades, symbol, strategy_config
                        )
                        if eligible and not corr_filter.passed:
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
                                    skip_reason: Optional[str] = None
                                    now_mono = time.monotonic()
                                    cooldown_until = _ibkr_entry_cooldown_until.get(
                                        trade.symbol, 0.0
                                    )
                                    if now_mono < cooldown_until:
                                        remaining = cooldown_until - now_mono
                                        skip_reason = (
                                            f"cooldown after recent failure "
                                            f"({remaining:.0f}s left)"
                                        )
                                    elif ibkr.has_pending_entry_order(trade.symbol):
                                        skip_reason = "unfilled BUY order already open"
                                    else:
                                        try:
                                            account = ibkr.get_account_summary()
                                            if (
                                                trade.position_value
                                                > account.buying_power
                                            ):
                                                skip_reason = (
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

                                    if skip_reason:
                                        logger.info(
                                            "Skipping %s IBKR entry — %s",
                                            trade.symbol,
                                            skip_reason,
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
                            logger.info("Risk: rejected %s — %s", symbol, decision.reason)

                    if db:
                        db.insert_prediction(state, prediction, trade_created=trade_created)
                        logger.info("Prediction stored")

                    jev_connected_this_cycle = True
                    jev_connected = True

                except Exception as exc:
                    logger.error("Jev prediction failed for %s: %s", symbol, exc)
                    jev_connected = False

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
                    execution_mode=execution_mode,
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

                db.write_heartbeat(
                    heartbeat_status,
                    quotes,
                    account=account,
                    ibkr_positions=ibkr_positions,
                    simulated_portfolio=simulated_portfolio,
                    open_trades=open_trades,
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
                    execution_mode=execution_mode,
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
            db.mark_trader_offline(bot_enabled, trading_mode, execution_mode)
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
