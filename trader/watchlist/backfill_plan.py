from __future__ import annotations

from typing import Iterable, List, Sequence, Set

from market.bars import BarStore, OPEN_POSITION_INTRADAY_FRESHNESS
from models.types import RiskSettings
from watchlist.resolution import effective_benchmark
from watchlist.rotation import backfill_order


def _unique(symbols: Iterable[str]) -> List[str]:
    ordered: List[str] = []
    seen: Set[str] = set()
    for raw in symbols:
        symbol = str(raw).strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            ordered.append(symbol)
    return ordered


def startup_backfill_universe(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str],
) -> tuple[List[str], List[str], List[str]]:
    """Return (critical_symbols, full_priority, deferred_pool_symbols)."""
    benchmark = effective_benchmark(risk_settings)
    open_list = _unique(open_symbols)
    if risk_settings.watchlist_rotation_enabled and risk_settings.watchlist_pool:
        active = _unique(risk_settings.watchlist_active)
        full = backfill_order(active, risk_settings.watchlist_pool, benchmark, open_list)
        critical = _unique([*open_list, *active, benchmark])
        critical_set = set(critical)
        deferred = [symbol for symbol in full if symbol not in critical_set]
        return critical, full, deferred
    from watchlist.resolution import resolve_trading_watchlist

    full = _unique(resolve_trading_watchlist(risk_settings, open_list))
    if benchmark and benchmark not in full:
        full.append(benchmark)
    return full, full, []


def symbols_needing_backfill_with_roles(
    bar_store: BarStore,
    *,
    symbols: Sequence[str],
    open_symbols: Sequence[str],
) -> tuple[List[str], List[str]]:
    """Split symbols into fresh-cache skips vs stale needing IBKR fetch."""
    open_set = {s.upper() for s in open_symbols if s}
    stale: List[str] = []
    fresh: List[str] = []
    for symbol in _unique(symbols):
        max_age = (
            OPEN_POSITION_INTRADAY_FRESHNESS
            if symbol in open_set
            else None
        )
        if bar_store.needs_backfill(symbol, intraday_max_age=max_age):
            stale.append(symbol)
        else:
            fresh.append(symbol)
    return stale, fresh
