from __future__ import annotations

import logging
from typing import Callable, Optional, Sequence

from broker.ibkr import IBKRClient
from config import Settings
from market.bars import BarStore
from models.types import DataSource

logger = logging.getLogger(__name__)


def backfill_watchlist_symbols(
    settings: Settings,
    bar_store: BarStore,
    ibkr: IBKRClient,
    symbols: Sequence[str],
    *,
    open_symbols: Optional[Sequence[str]] = None,
    on_progress: Optional[Callable[..., None]] = None,
) -> None:
    """Backfill watchlist symbols on the main thread (ib_insync needs its event loop)."""
    from market.bars import OPEN_POSITION_INTRADAY_FRESHNESS

    priority = list(dict.fromkeys(s.upper() for s in symbols if s))
    if not priority:
        return
    if settings.data_source != DataSource.IBKR or not ibkr.is_connected():
        return

    stale = set(bar_store.symbols_needing_backfill(priority))
    open_priority = list(dict.fromkeys(s.upper() for s in (open_symbols or []) if s))
    if open_priority:
        stale.update(
            bar_store.symbols_needing_backfill(
                open_priority,
                intraday_max_age=OPEN_POSITION_INTRADAY_FRESHNESS,
            )
        )
    stale_list = [symbol for symbol in priority if symbol in stale]
    for symbol in open_priority:
        if symbol in stale and symbol not in stale_list:
            stale_list.append(symbol)

    if not stale_list:
        logger.info(
            "Watchlist bar cache fresh — skipping backfill (%s symbols)",
            len(priority),
        )
        return

    logger.info(
        "Starting paced watchlist bar backfill for %s/%s symbol(s)",
        len(stale_list),
        len(priority),
    )
    summary = bar_store.backfill_universe(
        stale_list,
        ibkr,
        pacing_sec=settings.bar_backfill_pacing_sec,
        on_progress=on_progress,
    )
    logger.info(
        "Watchlist bar backfill complete — refreshed %s/%s symbol(s)",
        summary.refreshed,
        len(stale_list),
    )
    if summary.unqualified_symbols:
        logger.warning(
            "Unqualified during watchlist backfill: %s",
            ", ".join(summary.unqualified_symbols),
        )
