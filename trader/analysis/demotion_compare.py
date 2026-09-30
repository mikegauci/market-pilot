from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence


@dataclass(frozen=True)
class ClosedTradeExit:
    """Minimal closed-trade fields for demotion vs own-signal comparison."""

    trade_id: str
    symbol: str
    exit_reason: str
    net_pnl: float
    demoted_at_exit: bool = False


@dataclass(frozen=True)
class DemotionCompareResult:
    n_demotion_exits: int
    n_own_signal_exits: int
    n_other: int
    mean_pnl_demotion: Optional[float]
    mean_pnl_own_signal: Optional[float]
    demotion_exit_reasons: tuple[str, ...]


_DEMOTION_REASONS = frozenset(
    {
        "demotion_exit",
        "demotion_force",
        "demotion_max_hold",
        "max_hold",  # may include demoted shortened hold
    }
)

_OWN_SIGNAL_REASONS = frozenset(
    {
        "jev_sell",
        "sell",
        "take_profit",
        "stop_loss",
    }
)


def _mean(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def compare_demotion_vs_own_signal(
    trades: Sequence[ClosedTradeExit],
) -> DemotionCompareResult:
    """Contrast demotion-tagged exits vs own-signal / TP-SL exits (offline).

    Does not rewrite history — report-only using exit_reason labels and optional
    ``demoted_at_exit`` when known from decision logs.
    """
    demotion: List[float] = []
    own: List[float] = []
    other = 0
    demotion_reasons: List[str] = []

    for t in trades:
        reason = (t.exit_reason or "").lower()
        if t.demoted_at_exit or reason in _DEMOTION_REASONS or reason.startswith(
            "demotion"
        ):
            demotion.append(t.net_pnl)
            demotion_reasons.append(t.exit_reason)
        elif reason in _OWN_SIGNAL_REASONS:
            own.append(t.net_pnl)
        else:
            other += 1

    return DemotionCompareResult(
        n_demotion_exits=len(demotion),
        n_own_signal_exits=len(own),
        n_other=other,
        mean_pnl_demotion=_mean(demotion),
        mean_pnl_own_signal=_mean(own),
        demotion_exit_reasons=tuple(sorted(set(demotion_reasons))),
    )
