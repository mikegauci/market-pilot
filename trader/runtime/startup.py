from __future__ import annotations

import logging
import time
from typing import Callable, List, Optional

from broker.ibkr import IBKRClient
from config import Settings
from database.supabase import SupabaseRepository
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from models.types import RiskSettings
from watchlist.jev_screener import merge_core_watchlist, resolve_trading_watchlist
from watchlist.screener_scheduler import EMWatchlistScheduler, backfill_watchlist_symbols

logger = logging.getLogger(__name__)


def connect_ibkr_with_retries(
    client: IBKRClient,
    *,
    max_attempts: int = 1,
    delay_sec: float = 2.0,
) -> bool:
    for attempt in range(1, max_attempts + 1):
        try:
            client.connect()
            return True
        except Exception as exc:
            logger.warning(
                "IBKR connection attempt %s/%s failed: %s", attempt, max_attempts, exc
            )
            if attempt < max_attempts:
                time.sleep(delay_sec)
    return False


def run_ibkr_startup_backfill(
    *,
    settings: Settings,
    db: SupabaseRepository,
    bar_store: BarStore,
    ibkr: IBKRClient,
    risk_settings: RiskSettings,
    em_scheduler: EMWatchlistScheduler,
    load_em_universe_fn: Callable[[], List[str]],
    on_progress: Optional[Callable[[object, int, int], None]] = None,
) -> None:
    """Watchlist bar backfill and optional EM universe backfill after IBKR connect."""
    open_symbols = [trade.symbol for trade in db.get_open_trades()]
    priority_symbols = list(
        dict.fromkeys(
            merge_core_watchlist(risk_settings, open_symbols)
            + resolve_trading_watchlist(risk_settings, open_symbols)
        )
    )
    backfill_watchlist_symbols(
        settings,
        bar_store,
        ibkr,
        priority_symbols,
        open_symbols=open_symbols,
        on_progress=on_progress,
    )
    if risk_settings.watchlist_dynamic_enabled:
        try:
            em_universe = load_em_universe_fn()
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
