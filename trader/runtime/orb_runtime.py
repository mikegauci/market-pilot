"""Per-cycle ORB preparation: authoritative opening-window bars, in-play ranking, watchlist pick.

Live tick volume is unreliable around the open (the cumulative-volume feed resets), so the
opening window and its baseline come from IBKR historical 5-minute bars, fetched once per
symbol per day and stored back into the bar cache.
"""

from __future__ import annotations

import logging
import time
from dataclasses import replace
from datetime import datetime
from typing import TYPE_CHECKING, Dict, List, Optional, Sequence

from market.bars import BAR_SIZE_INTRADAY, Bar, BarStore
from market.hours import (
    is_us_regular_session_open,
    minutes_since_regular_open,
    trading_calendar_date,
)
from market.opening_range import (
    InPlayMetrics,
    in_play_metrics,
    opening_range_today,
)
from models.types import DataSource, RiskSettings
from runtime.state import TraderRuntimeState
from strategy.orb import in_play_reason
from watchlist.resolution import (
    resolve_rotation_scan_watchlist,
    untradeable_benchmark_symbols,
)

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from config import Settings
    from database.supabase import SupabaseRepository
    from runtime.loop.eval_cycle_state import EvalCycleScratch

logger = logging.getLogger(__name__)

ORB_HISTORY_DURATION = "5 D"
ORB_FETCH_BATCH = 2
ORB_FETCH_SPACING_SEC = 0.5
ORB_MAX_FETCH_ATTEMPTS = 3
# The first bar must have closed and be available from IBKR.
ORB_RANGE_GRACE_MIN = 0.3
# Pick the day's watchlist no later than this long after the range closes.
ORB_SELECTION_DEADLINE_MIN = 6.0


def orb_candidate_symbols(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str],
) -> List[str]:
    """Open positions first, then the current active list, then the rest of the pool."""
    blocked = untradeable_benchmark_symbols(risk_settings)
    ordered: List[str] = []
    for raw in [
        *open_symbols,
        *risk_settings.watchlist_active,
        *risk_settings.watchlist_pool,
        *risk_settings.watchlist,
    ]:
        symbol = str(raw).strip().upper()
        if symbol and symbol not in blocked and symbol not in ordered:
            ordered.append(symbol)
    return ordered


def rank_in_play(
    symbols: Sequence[str],
    metrics: Dict[str, InPlayMetrics],
    risk_settings: RiskSettings,
) -> List[str]:
    """Symbols passing the in-play gate, highest relative volume first (|gap| breaks ties)."""
    passing = [
        symbol
        for symbol in symbols
        if symbol in metrics
        and (metrics[symbol].rvol is not None or metrics[symbol].gap_pct is not None)
        and in_play_reason(metrics[symbol], risk_settings) is None
    ]
    return sorted(
        passing,
        key=lambda symbol: (
            -(metrics[symbol].rvol or 0.0),
            -abs(metrics[symbol].gap_pct or 0.0),
        ),
    )


def _record_symbol(
    runtime: TraderRuntimeState,
    symbol: str,
    bars: Sequence[Bar],
    range_minutes: int,
    now: Optional[datetime] = None,
) -> None:
    orb = runtime.orb
    opening = opening_range_today(symbol, bars, range_minutes, now=now)
    if opening is not None:
        orb.ranges[symbol] = opening
    orb.metrics[symbol] = in_play_metrics(bars, range_minutes, now=now)


def _fetch_symbol_history(
    symbol: str,
    ibkr: "IBKRClient",
    bar_store: BarStore,
    runtime: TraderRuntimeState,
    range_minutes: int,
    now: Optional[datetime] = None,
) -> bool:
    orb = runtime.orb
    orb.history_attempts[symbol] = orb.history_attempts.get(symbol, 0) + 1
    try:
        bars = ibkr.fetch_historical_bars(
            symbol,
            duration=ORB_HISTORY_DURATION,
            bar_size=BAR_SIZE_INTRADAY,
        )
    except Exception as exc:
        logger.warning("ORB history fetch failed for %s: %s", symbol, exc)
        return False
    if not bars:
        return False
    bar_store.repository.upsert_bars(bars)
    bar_store.invalidate_bar_cache(symbol, BAR_SIZE_INTRADAY)
    orb.history_done.add(symbol)
    _record_symbol(runtime, symbol, bars, range_minutes, now)
    return True


def apply_in_play_selection(
    db: "SupabaseRepository",
    scratch: "EvalCycleScratch",
    runtime: TraderRuntimeState,
) -> str:
    """Make the active watchlist the day's stocks in play (rotation is paused in ORB mode).

    Returns "saved", "empty" (nothing in play yet) or "failed" (save error: retry next cycle)."""
    risk = scratch.risk_settings
    orb = runtime.orb
    pool = orb_candidate_symbols(risk, scratch.open_symbols)
    ranked = rank_in_play(pool, orb.metrics, risk)
    if not ranked:
        logger.debug("ORB: no stocks in play yet; keeping current list")
        return "empty"
    chosen = ranked[: max(1, risk.watchlist_active_size)]
    detail = ", ".join(
        f"{symbol} {orb.metrics[symbol].rvol:.1f}x"
        if orb.metrics[symbol].rvol is not None
        else f"{symbol} gap {orb.metrics[symbol].gap_pct:.1f}%"
        for symbol in chosen[:6]
    )
    note = f"ORB in-play {len(chosen)}/{len(pool)}: {detail}"
    try:
        db.save_watchlist_rotation(chosen, note)
    except Exception as exc:
        logger.warning("Could not save ORB selection: %s", exc)
        return "failed"
    orb.selected = True
    scratch.risk_settings = replace(
        risk,
        watchlist_active=chosen,
        watchlist_last_rotation_note=note[:240],
    )
    scratch.watchlist = resolve_rotation_scan_watchlist(scratch.risk_settings)
    logger.info(note)
    return "saved"


def run_cycle_orb_prep(
    *,
    db: Optional["SupabaseRepository"],
    settings: "Settings",
    ibkr: "IBKRClient",
    bar_store: BarStore,
    scratch: "EvalCycleScratch",
    runtime: TraderRuntimeState,
    now: Optional[datetime] = None,
) -> None:
    risk = scratch.risk_settings
    if risk.entry_mode != "orb" or db is None:
        return
    if settings.data_source == DataSource.IBKR and not is_us_regular_session_open(now):
        return

    orb = runtime.orb
    orb.reset_for(trading_calendar_date(now))

    elapsed = minutes_since_regular_open(now)
    range_minutes = risk.orb_range_minutes
    if elapsed < range_minutes + ORB_RANGE_GRACE_MIN:
        return
    if elapsed > risk.orb_entry_cutoff_minutes:
        # No ORB entries are possible any more: skip the history fetches and watchlist rewrite.
        return

    symbols = orb_candidate_symbols(risk, scratch.open_symbols)
    use_history = settings.data_source == DataSource.IBKR and ibkr.is_connected()

    if use_history:
        pending = [
            symbol
            for symbol in symbols
            if symbol not in orb.history_done
            and orb.history_attempts.get(symbol, 0) < ORB_MAX_FETCH_ATTEMPTS
        ]
        for index, symbol in enumerate(pending[:ORB_FETCH_BATCH]):
            if index:
                time.sleep(ORB_FETCH_SPACING_SEC)
            _fetch_symbol_history(symbol, ibkr, bar_store, runtime, range_minutes, now)
    else:
        for symbol in symbols:
            if symbol not in orb.ranges:
                _record_symbol(
                    runtime,
                    symbol,
                    bar_store.get_intraday_bars(symbol),
                    range_minutes,
                    now,
                )

    if orb.selected:
        return
    settled = all(
        symbol in orb.history_done
        or orb.history_attempts.get(symbol, 0) >= ORB_MAX_FETCH_ATTEMPTS
        for symbol in symbols
    ) if use_history else True
    deadline = elapsed >= range_minutes + ORB_SELECTION_DEADLINE_MIN
    if settled or deadline:
        outcome = apply_in_play_selection(db, scratch, runtime)
        if outcome == "empty" and settled:
            # Every candidate is fetched (or given up on) and nothing is in play: done for today.
            orb.selected = True
