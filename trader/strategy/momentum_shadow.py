"""Watch-only momentum check logged on each Jev prediction.

Never blocks a trade. It records whether a stricter entry rule *would* have kept
or blocked the signal so the dashboard can compare outcomes before the rule goes live.

Rule: 5m change >= min_change_5m_pct AND (volume_ratio >= min_volume_ratio OR
EMA9 within fresh_cross_max_pct of EMA20, i.e. an uptrend that is just starting).
"""

from __future__ import annotations

from dataclasses import replace
from typing import Optional, Tuple

from models.types import MarketState
from strategy.config import StrategyConfig

WOULD_KEEP = "would_keep"
WOULD_BLOCK = "would_block"


def momentum_shadow_verdict(
    state: MarketState, config: StrategyConfig
) -> Optional[Tuple[str, str]]:
    """Return (verdict, plain-language note), or None when the check is off or data is missing."""
    min_change = config.shadow_momentum_min_change_5m_pct
    if min_change <= 0 or state.change_5m is None:
        return None

    change = state.change_5m
    volume = state.volume_ratio
    ema_gap_pct: Optional[float] = None
    if state.ema_9 is not None and state.ema_20 is not None and state.ema_20 > 0:
        ema_gap_pct = (state.ema_9 / state.ema_20 - 1) * 100

    volume_text = f"volume {volume:.1f}x normal" if volume is not None else "volume unknown"

    if change < min_change:
        return (
            WOULD_BLOCK,
            f"Too slow: rose {change:.2f}% in 5 min (needs {min_change:.2f}%), {volume_text}.",
        )

    strong_volume = volume is not None and volume >= config.shadow_momentum_min_volume_ratio
    fresh_trend = (
        ema_gap_pct is not None and ema_gap_pct < config.shadow_momentum_fresh_cross_max_pct
    )
    if strong_volume:
        return (
            WOULD_KEEP,
            f"Strong move: rose {change:.2f}% in 5 min on {volume_text}.",
        )
    if fresh_trend:
        return (
            WOULD_KEEP,
            f"Early trend: rose {change:.2f}% in 5 min and the uptrend is just starting.",
        )
    return (
        WOULD_BLOCK,
        f"No extra support: rose {change:.2f}% in 5 min, but {volume_text} "
        f"(needs {config.shadow_momentum_min_volume_ratio:.1f}x) and the trend is not new.",
    )


def with_momentum_shadow(state: MarketState, config: StrategyConfig) -> MarketState:
    """Copy of state with the watch-only verdict attached for the prediction snapshot."""
    result = momentum_shadow_verdict(state, config)
    if result is None:
        return state
    verdict, note = result
    return replace(state, momentum_shadow_verdict=verdict, momentum_shadow_note=note)
