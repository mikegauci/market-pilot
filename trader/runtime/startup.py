from __future__ import annotations

import logging
import time
from typing import Callable, List, Optional

from broker.ibkr import IBKRClient
from config import Settings
from database.supabase import SupabaseRepository
from market.bars import BarStore
from models.types import RiskSettings
from runtime.state import TraderRuntimeState
from watchlist.backfill import run_phased_startup_backfill

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
    runtime: TraderRuntimeState,
    on_progress: Optional[Callable[[object, int, int], None]] = None,
) -> None:
    """Watchlist bar backfill after IBKR connect."""
    open_symbols = [trade.symbol for trade in db.get_open_trades()]
    run_phased_startup_backfill(
        settings,
        bar_store,
        ibkr,
        risk_settings,
        open_symbols,
        runtime,
        on_progress=on_progress,
    )
