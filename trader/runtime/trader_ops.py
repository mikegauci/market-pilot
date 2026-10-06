from __future__ import annotations

import logging
import time
from typing import List, Optional

from broker.ibkr import IBKRClient
from broker.reconcile import nonzero_positions
from config import Settings
from database.supabase import SupabaseRepository
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
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
from runtime.capital import resolve_effective_capital, sync_risk_manager_capital
from runtime.state import TraderRuntimeState

logger = logging.getLogger(__name__)

SHUTDOWN_SLEEP_CHUNK_SEC = 0.5


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("ib_insync").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def interruptible_sleep(seconds: float, runtime: TraderRuntimeState) -> None:
    deadline = time.monotonic() + seconds
    while not runtime.shutdown_requested:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(SHUTDOWN_SLEEP_CHUNK_SEC, remaining))


def merge_watchlist_symbols(watchlist: list[str], benchmark: str = "") -> list[str]:
    merged = list(watchlist)
    benchmark_symbol = (benchmark or "").strip().upper()
    if benchmark_symbol:
        merged = list(dict.fromkeys(merged + [benchmark_symbol]))
    return merged


def apply_watchlist_update(
    watchlist: List[str],
    benchmark_symbol: str,
    mock: MockMarketProvider,
    ibkr: IBKRClient,
    settings: Settings,
) -> List[str]:
    symbols = merge_watchlist_symbols(watchlist, benchmark_symbol)
    mock.ensure_symbols(symbols)
    if settings.data_source == DataSource.IBKR and ibkr.is_connected():
        ibkr.sync_watchlist_subscriptions(symbols)
    return symbols


def sync_watchlist_symbols(
    all_symbols_list: list[str],
    mock: MockMarketProvider,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    data_source: DataSource,
    runtime: TraderRuntimeState,
) -> List[str]:
    """Pick up watchlist changes at runtime without restarting the trader."""
    mock.ensure_symbols(all_symbols_list)
    new_symbols = [
        symbol
        for symbol in all_symbols_list
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


def pulse_bot_status(
    db: SupabaseRepository,
    *,
    enabled: bool,
    trading_mode: TradingMode,
    execution_mode: ExecutionMode,
    ibkr_connected: bool,
    jev_connected: bool = False,
    last_error: Optional[str] = None,
) -> None:
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


def get_quotes(
    settings: Settings,
    ibkr: IBKRClient,
    mock: MockMarketProvider,
    symbols: list[str],
) -> list[Quote]:
    if settings.data_source == DataSource.IBKR and ibkr.is_connected():
        return ibkr.get_quotes(symbols, wait_sec=0.5)
    return mock.get_quotes(symbols)


def sync_portfolio_state(
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


def init_risk_manager(
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
