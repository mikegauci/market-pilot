from __future__ import annotations

import logging
import signal
import sys
import time
from typing import Dict, Optional, Set

from broker.execution import sync_ibkr_exits
from broker.ibkr import IBKRClient
from config import Settings, load_settings
from database.supabase import SupabaseRepository
from jev.client import JevClient
from market.history import HistoryStore
from market.hours import is_us_regular_session_open
from market.indicators import build_market_state
from market.mock import MockMarketProvider
from models.types import BotStatusUpdate, DataSource, ExecutionMode, Quote, TradingMode
from risk.manager import RiskManager
from strategy.signals import is_trade_eligible, signal_tier

logger = logging.getLogger(__name__)

_shutdown_requested = False
_warmup_logged: Set[str] = set()
_last_closed_market_log = 0.0
_CLOSED_MARKET_LOG_INTERVAL_SEC = 300.0


def _handle_shutdown(signum: int, _frame: object) -> None:
    global _shutdown_requested
    logger.info("Received signal %s, shutting down...", signum)
    _shutdown_requested = True


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )


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


def _get_quotes(
    settings: Settings,
    ibkr: IBKRClient,
    mock: MockMarketProvider,
    symbols: list[str],
) -> list[Quote]:
    if settings.data_source == DataSource.IBKR and ibkr.is_connected():
        return ibkr.get_quotes(symbols, wait_sec=0.5)
    return mock.get_quotes()


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


def _init_risk_manager(
    db: SupabaseRepository,
    ibkr: IBKRClient,
    trading_mode: TradingMode,
) -> RiskManager:
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

    strategy_settings = db.get_settings()
    watchlist = strategy_settings.watchlist or settings.watchlist_symbols
    all_symbols = list(dict.fromkeys(watchlist + ["SPY"]))

    mock = MockMarketProvider(all_symbols)
    history = HistoryStore(all_symbols)
    if settings.data_source == DataSource.MOCK:
        mock.seed_history(history)
        logger.info("Seeded mock price history for indicators")
    elif settings.data_source == DataSource.IBKR:
        logger.info("Using IBKR quotes to build indicator history (warm-up ~15 min)")

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

    if settings.data_source == DataSource.IBKR:
        if _connect_ibkr(ibkr, max_attempts=3):
            ibkr.subscribe_watchlist(all_symbols)
            logger.info("Connected to IBKR (%s:%s)", settings.ibkr_host, settings.ibkr_port)
        else:
            logger.warning("IBKR unavailable — falling back to mock market data")
    else:
        logger.info("Using mock market data (IBKR not required)")

    trading_mode = settings.trading_mode
    risk_manager: Optional[RiskManager] = None
    if db:
        trading_mode = db.get_trading_mode()
        risk_manager = _init_risk_manager(db, ibkr, trading_mode)
        db_execution = db.get_execution_mode(settings.execution_mode)
        if db_execution != settings.execution_mode:
            logger.info(
                "Execution mode from dashboard: %s (env default: %s)",
                db_execution.value,
                settings.execution_mode.value,
            )
        logger.info(
            "Risk engine loaded — %s open simulated trades, capital $%.2f",
            len(risk_manager.open_trades),
            risk_manager.effective_capital,
        )

    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    bot_enabled = False
    jev_connected = False
    execution_mode = settings.execution_mode
    last_heartbeat = 0.0
    data_source_label = "ibkr" if ibkr.is_connected() else "mock"

    while not _shutdown_requested:
        loop_start = time.monotonic()
        jev_connected_this_cycle = False
        market_open = True

        try:
            if db:
                bot_enabled = db.get_bot_enabled()
                trading_mode = db.get_trading_mode()
                execution_mode = db.get_execution_mode(settings.execution_mode)
                strategy_settings = db.get_settings()
                watchlist = strategy_settings.watchlist or settings.watchlist_symbols
                if risk_manager:
                    risk_manager.update_settings(db.get_risk_settings())
                    capital, currency = _resolve_effective_capital(
                        ibkr,
                        risk_manager.settings.account_capital,
                    )
                    risk_manager.update_capital(capital, currency)

            quotes = _get_quotes(settings, ibkr, mock, all_symbols)
            quotes_by_symbol: Dict[str, Quote] = {q.symbol: q for q in quotes}

            for quote in quotes:
                history.record(quote)

            if risk_manager and db:
                closed = risk_manager.check_exits(quotes_by_symbol)
                for closed_trade in closed:
                    db.close_trade(
                        closed_trade.trade_id,
                        closed_trade.exit_price,
                        closed_trade.exit_time,
                        closed_trade.gross_pnl,
                        closed_trade.net_pnl,
                    )
                if closed:
                    risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())

                if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                    sync_ibkr_exits(ibkr, risk_manager, db)

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

            for symbol in watchlist if market_open else []:
                quote = quotes_by_symbol.get(symbol)
                if quote is None:
                    continue

                state = build_market_state(quote, history, spy_history)
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

                try:
                    prediction = jev.predict(state)
                    tier = signal_tier(
                        prediction,
                        strategy_settings.signal_record_threshold,
                        strategy_settings.minimum_jev_confidence,
                    )
                    _log_jev_prediction(prediction, tier)

                    trade_created = False
                    if is_trade_eligible(tier) and risk_manager and db:
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
                                    bracket = ibkr.place_bracket_buy(
                                        trade.symbol,
                                        trade.quantity,
                                        trade.stop_loss,
                                        trade.take_profit,
                                    )
                                    trade.execution_mode = "ibkr"
                                    trade.entry_price = bracket.fill_price
                                    trade.quantity = bracket.filled_quantity
                                    trade.position_value = (
                                        bracket.fill_price * bracket.filled_quantity
                                    )
                                    trade.ibkr_parent_order_id = bracket.parent_order_id
                                    trade.ibkr_sl_order_id = bracket.sl_order_id
                                    trade.ibkr_tp_order_id = bracket.tp_order_id
                                    db.insert_trade(trade)
                                    risk_manager.register_open_trade(trade)
                                    trade_created = True
                                    logger.info(
                                        "IBKR BUY %s x %.0f @ $%.2f (SL $%.2f / TP $%.2f)",
                                        trade.symbol,
                                        trade.quantity,
                                        trade.entry_price,
                                        trade.stop_loss,
                                        trade.take_profit,
                                    )
                                except Exception as exc:
                                    logger.error(
                                        "IBKR order failed for %s: %s", symbol, exc
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
                                trade_created = True
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

            now = time.monotonic()
            if db and (now - last_heartbeat) >= settings.heartbeat_interval_sec:
                if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                    try:
                        account = ibkr.get_account_summary()
                        positions = ibkr.get_positions()
                        db.insert_portfolio_snapshot(account)
                        db.upsert_positions(positions)
                    except Exception as exc:
                        logger.warning("IBKR heartbeat failed: %s", exc)
                elif risk_manager:
                    portfolio = risk_manager.get_portfolio_snapshot(quotes_by_symbol)
                    db.insert_simulated_portfolio(portfolio)
                    db.sync_positions_from_trades(risk_manager.open_trades, quotes)

                db.insert_market_snapshots(quotes)
                db.update_bot_status(
                    BotStatusUpdate(
                        enabled=bot_enabled,
                        trading_mode=trading_mode,
                        ibkr_connected=ibkr.is_connected(),
                        jev_connected=jev_connected_this_cycle or jev_connected,
                        execution_mode=execution_mode,
                        last_error=None,
                    )
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
        sleep_for = max(0.0, interval - elapsed)
        if sleep_for > 0 and not _shutdown_requested:
            time.sleep(sleep_for)

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
