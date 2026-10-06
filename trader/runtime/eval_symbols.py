from __future__ import annotations

from typing import List, Optional, Sequence

from models.types import RiskSettings
from watchlist.resolution import strip_benchmark_symbol


def eval_allow_five_min_fallback(
    is_open_position: bool,
    symbol_intraday_bars: Optional[Sequence[object]],
    warmup_min_1m_bars: int,
) -> bool:
    """Use cached 5m bars for Jev when live 1m tape is still warming up.

    Open positions already had this path; extend it to any symbol with enough
    intraday history (e.g. US mega-caps backfilled at startup or after a pin).
    """
    if is_open_position:
        return True
    return (
        symbol_intraday_bars is not None
        and len(symbol_intraday_bars) >= warmup_min_1m_bars
    )


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
