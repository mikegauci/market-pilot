from __future__ import annotations

import logging
from typing import Callable, Optional, Sequence, TYPE_CHECKING

from broker.ibkr import IBKRClient
from config import Settings
from market.bars import BarStore
from models.types import DataSource, RiskSettings
from watchlist.backfill_plan import (
    startup_backfill_universe,
    symbols_needing_backfill_with_roles,
)

if TYPE_CHECKING:
    from runtime.state import TraderRuntimeState

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


def run_phased_startup_backfill(
    settings: Settings,
    bar_store: BarStore,
    ibkr: IBKRClient,
    risk_settings: RiskSettings,
    open_symbols: Sequence[str],
    runtime: "TraderRuntimeState",
    *,
    on_progress: Optional[Callable[..., None]] = None,
) -> None:
    """Backfill critical symbols before the loop; queue stale inactive pool names."""
    if settings.data_source != DataSource.IBKR or not ibkr.is_connected():
        return

    critical, _full, deferred_pool = startup_backfill_universe(
        risk_settings, open_symbols
    )
    stale_critical, fresh_critical = symbols_needing_backfill_with_roles(
        bar_store,
        symbols=critical,
        open_symbols=open_symbols,
    )
    stale_deferred, fresh_deferred = symbols_needing_backfill_with_roles(
        bar_store,
        symbols=deferred_pool,
        open_symbols=(),
    )
    runtime.deferred_backfill_queue = list(stale_deferred)

    if fresh_critical:
        logger.info(
            "Fresh cache skip (critical startup): %s",
            ", ".join(fresh_critical),
        )
    if fresh_deferred:
        logger.info(
            "Fresh cache skip (deferred pool): %s symbol(s)",
            len(fresh_deferred),
        )

    if not stale_critical and not stale_deferred:
        logger.info(
            "Watchlist bar cache fresh — skipping backfill (%s symbols)",
            len(critical) + len(deferred_pool),
        )
        return

    if stale_deferred:
        logger.info(
            "Deferred pool backfill queued: %s symbol(s) — %s",
            len(stale_deferred),
            ", ".join(stale_deferred[:8])
            + ("…" if len(stale_deferred) > 8 else ""),
        )

    if not stale_critical:
        logger.info(
            "Critical startup backfill: all %s symbol(s) fresh — starting loop",
            len(critical),
        )
        return

    logger.info(
        "Critical startup backfill for %s/%s symbol(s)",
        len(stale_critical),
        len(critical),
    )
    summary = bar_store.backfill_universe(
        stale_critical,
        ibkr,
        pacing_sec=settings.bar_backfill_pacing_sec,
        on_progress=on_progress,
    )
    logger.info(
        "Critical startup backfill complete — refreshed %s/%s symbol(s)",
        summary.refreshed,
        len(stale_critical),
    )
    if summary.unqualified_symbols:
        logger.warning(
            "Unqualified during critical startup backfill: %s",
            ", ".join(summary.unqualified_symbols),
        )


def drain_deferred_backfill_queue(
    settings: Settings,
    bar_store: BarStore,
    ibkr: IBKRClient,
    runtime: "TraderRuntimeState",
) -> None:
    """Refresh at most one stale inactive pool symbol per eval cycle."""
    if settings.data_source != DataSource.IBKR or not ibkr.is_connected():
        return
    if not runtime.deferred_backfill_queue:
        return

    while runtime.deferred_backfill_queue:
        symbol = runtime.deferred_backfill_queue.pop(0)
        if not bar_store.needs_backfill(symbol):
            logger.debug("Deferred pool backfill skip (fresh): %s", symbol)
            continue
        logger.info(
            "Deferred pool backfill (%s remaining): %s",
            len(runtime.deferred_backfill_queue),
            symbol,
        )
        result = bar_store.backfill_symbol(symbol, ibkr)
        if result.status == "skipped_fresh":
            logger.debug("Deferred pool backfill skip (fresh after check): %s", symbol)
            continue
        if result.refreshed:
            logger.info("Deferred pool backfill refreshed %s", symbol)
        elif result.status == "unqualified":
            logger.warning("Deferred pool backfill unqualified: %s", symbol)
        elif result.status == "disconnected":
            runtime.deferred_backfill_queue.insert(0, symbol)
        return
