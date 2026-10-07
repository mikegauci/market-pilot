"""Pick the active watchlist from a larger pool without calling Jev."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from market.session import SESSION_DISQUALIFIED_SCORE
from strategy.ema_gate import entry_ema_gate_blocks_rotation, normalize_entry_ema_gate


@dataclass(frozen=True)
class RotationCandidate:
    symbol: str
    change_5m: Optional[float] = None
    change_15m: Optional[float] = None
    volume_ratio: Optional[float] = None
    rsi: Optional[float] = None
    price: Optional[float] = None
    ema_9: Optional[float] = None
    ema_20: Optional[float] = None
    session_change_pct: Optional[float] = None


@dataclass(frozen=True)
class RotationResult:
    active: list[str]
    note: str
    swapped_in: list[str]
    swapped_out: list[str]


def relative_strength(
    change: Optional[float],
    benchmark_change: Optional[float],
) -> Optional[float]:
    if change is None or benchmark_change is None:
        return None
    return change - benchmark_change


def rotation_score_eligible(score: float) -> bool:
    return score > SESSION_DISQUALIFIED_SCORE / 2


def score_candidate(
    candidate: RotationCandidate,
    *,
    benchmark_change_5m: Optional[float],
    benchmark_change_15m: Optional[float],
    min_volume_ratio: float,
    max_rsi: float,
    min_session_change_pct: Optional[float] = None,
    entry_ema_gate: str = "ema_20",
) -> float:
    """Higher is better. Overbought names rank last, matching Jev's buy rules."""
    if min_session_change_pct is not None:
        if candidate.session_change_pct is None:
            return SESSION_DISQUALIFIED_SCORE
        if candidate.session_change_pct < min_session_change_pct:
            return SESSION_DISQUALIFIED_SCORE
    gate = normalize_entry_ema_gate(entry_ema_gate)
    if entry_ema_gate_blocks_rotation(
        price=candidate.price,
        ema_9=candidate.ema_9,
        ema_20=candidate.ema_20,
        gate=gate,
    ):
        return SESSION_DISQUALIFIED_SCORE
    score = 0.0
    rs5 = relative_strength(candidate.change_5m, benchmark_change_5m)
    rs15 = relative_strength(candidate.change_15m, benchmark_change_15m)
    if rs5 is not None:
        score += rs5 * 2.0
    if rs15 is not None:
        score += rs15
    if candidate.volume_ratio is not None:
        score += min(candidate.volume_ratio, 3.0) * 0.05
        if min_volume_ratio > 0 and candidate.volume_ratio < min_volume_ratio:
            score -= 1.0
    if candidate.rsi is not None and candidate.rsi > max_rsi:
        score -= 10.0
    return score


def _unique(symbols: Iterable[str]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        symbol = str(raw).strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            ordered.append(symbol)
    return ordered


def capped_active_size(
    requested: int,
    current_count: int,
    median_cycle_sec: Optional[float],
    *,
    gap_limit_sec: float = 25.0,
) -> int:
    """Refuse to grow the active list when a full scan already takes too long."""
    size = max(1, int(requested))
    if (
        median_cycle_sec is not None
        and median_cycle_sec > gap_limit_sec
        and current_count > 0
        and size > current_count
    ):
        return current_count
    return size


def median_cycle_sec(samples: Sequence[float]) -> Optional[float]:
    values = sorted(sample for sample in samples if sample >= 0)
    if not values:
        return None
    mid = len(values) // 2
    if len(values) % 2 == 1:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2


def backfill_order(
    active: Sequence[str],
    pool: Sequence[str],
    benchmark: str,
    open_symbols: Sequence[str] = (),
) -> list[str]:
    """QQQ and the active names first, then the rest of the pool."""
    return _unique([*active, benchmark, *open_symbols, *pool])


def rotate_active(
    pool: Sequence[str],
    current: Sequence[str],
    scores: dict[str, float],
    *,
    active_size: int,
    max_swaps: int,
    protected: Iterable[str] = (),
    incumbent_margin_fraction: float = 0.20,
) -> RotationResult:
    """Refresh the active list. Protected names (open trades, in-progress confirms) stay.

    Incumbents remain at full size until an eligible pool name wins a capped swap;
    low scores (EMA, session floor, etc.) block promotion only, not silent eviction.
    """
    pool_list = _unique(pool)
    pool_set = set(pool_list)
    protected_list = _unique(protected)
    protected_set = set(protected_list)
    current_list = _unique(current)
    size = max(1, int(active_size), len(protected_list))

    ranked = sorted(pool_list, key=lambda symbol: scores.get(symbol, -1e9), reverse=True)

    def eligible(symbol: str) -> bool:
        return rotation_score_eligible(scores.get(symbol.upper(), -1e9))

    if not current_list:
        eligible_ranked = [symbol for symbol in ranked if eligible(symbol)]
        chosen = _unique([*protected_list, *eligible_ranked])[:size]
        seeded = [symbol for symbol in chosen if symbol not in protected_set]
        return RotationResult(chosen, "seeded active list", seeded, [])

    score_values = [scores.get(symbol, 0.0) for symbol in pool_list] or [0.0]
    span = max(score_values) - min(score_values)
    margin = max(0.05, incumbent_margin_fraction * span) if span else 0.05

    base = [
        symbol
        for symbol in _unique([*protected_list, *current_list])
        if symbol in pool_set or symbol in protected_set
    ]
    while len(base) > size:
        droppable = [symbol for symbol in base if symbol not in protected_set]
        if not droppable:
            break
        weakest = min(droppable, key=lambda symbol: scores.get(symbol, -1e9))
        base.remove(weakest)

    swapped_in: list[str] = []
    swapped_out: list[str] = []
    for _ in range(max(0, int(max_swaps))):
        challengers = [
            symbol for symbol in ranked if symbol not in base and eligible(symbol)
        ]
        if not challengers:
            break
        challenger = challengers[0]
        incumbents = [symbol for symbol in base if symbol not in protected_set]
        if incumbents and len(base) >= size:
            weakest = min(incumbents, key=lambda symbol: scores.get(symbol, -1e9))
            if scores.get(challenger, -1e9) <= scores.get(weakest, -1e9) + margin:
                break
            base.remove(weakest)
            swapped_out.append(weakest)
        elif len(base) >= size:
            break
        base.append(challenger)
        swapped_in.append(challenger)

    if len(base) < size:
        for symbol in ranked:
            if symbol in base or not eligible(symbol):
                continue
            base.append(symbol)
            if symbol not in swapped_in:
                swapped_in.append(symbol)
            if len(base) >= size:
                break

    if not swapped_in and not swapped_out:
        note = "no change"
    else:
        parts: list[str] = []
        if swapped_in:
            parts.append(f"added {', '.join(swapped_in)}")
        if swapped_out:
            parts.append(f"removed {', '.join(swapped_out)}")
        note = " · ".join(parts)
    return RotationResult(base, note, swapped_in, swapped_out)
