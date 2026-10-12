"""Opening range breakout (ORB) entry rule — long only, no Jev required.

Skip reasons are a stable API (aggregated by the dashboard): ``orb_range_not_ready``,
``orb_window_closed``, ``not_in_play``, ``orb_no_breakout``, ``orb_extended``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from market.opening_range import InPlayMetrics, OpeningRange
from models.types import RiskSettings
from strategy.config import StrategyConfig

DEFAULT_ORB_REWARD_RISK = 2.0
# Skip a breakout that already ran this far above the range high: one opening-range size,
# but never less than this fraction of price (tight ranges would otherwise reject every entry).
MAX_EXTENSION_RANGES = 1.0
MIN_EXTENSION_PCT = 0.003


@dataclass(frozen=True)
class OrbSignal:
    ok: bool
    reason: str = ""
    stop_pct: Optional[float] = None
    take_pct: Optional[float] = None


def in_play_reason(
    metrics: Optional[InPlayMetrics],
    settings: RiskSettings,
) -> Optional[str]:
    """None when the symbol is "in play"; otherwise a ``not_in_play (...)`` reason."""
    min_rvol = settings.in_play_min_rvol
    min_gap = settings.in_play_min_gap_pct
    if min_rvol is None and min_gap is None:
        return None
    if metrics is None:
        return "not_in_play (no volume history)"
    if min_rvol is not None and min_rvol > 0:
        if metrics.rvol is None:
            return "not_in_play (rvol unknown)"
        if metrics.rvol < min_rvol:
            return f"not_in_play (rvol {metrics.rvol:.1f}x < {min_rvol:.1f}x)"
    if min_gap is not None and min_gap > 0:
        if metrics.gap_pct is None:
            return "not_in_play (gap unknown)"
        if abs(metrics.gap_pct) < min_gap:
            return f"not_in_play (gap {metrics.gap_pct:.1f}% < {min_gap:.1f}%)"
    return None


def evaluate_orb(
    price: float,
    opening_range: Optional[OpeningRange],
    metrics: Optional[InPlayMetrics],
    settings: RiskSettings,
    strategy_config: StrategyConfig,
    minutes_since_open: float,
) -> OrbSignal:
    if minutes_since_open > settings.orb_entry_cutoff_minutes:
        return OrbSignal(False, "orb_window_closed")
    if minutes_since_open < settings.orb_range_minutes or opening_range is None:
        return OrbSignal(False, "orb_range_not_ready")

    reason = in_play_reason(metrics, settings)
    if reason is not None:
        return OrbSignal(False, reason)

    if price <= opening_range.high:
        return OrbSignal(False, "orb_no_breakout")
    max_extension = max(opening_range.size * MAX_EXTENSION_RANGES, price * MIN_EXTENSION_PCT)
    if price - opening_range.high > max_extension:
        return OrbSignal(False, "orb_extended")

    # Stop at the range low, clamped to the strategy's min/max stop distance.
    raw_stop_pct = (price - opening_range.low) / price
    stop_pct = max(
        strategy_config.min_stop_loss_pct,
        min(strategy_config.max_stop_loss_pct, raw_stop_pct),
    )
    reward_risk = settings.min_reward_risk if settings.min_reward_risk > 0 else DEFAULT_ORB_REWARD_RISK
    return OrbSignal(True, "ok", stop_pct=stop_pct, take_pct=stop_pct * reward_risk)
