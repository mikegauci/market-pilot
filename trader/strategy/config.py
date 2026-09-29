from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Tuple


@dataclass(frozen=True)
class StrategyConfig:
    """Tightened entry/exit rules for Jev-driven day trading."""

    max_spread_pct: float = 0.0015
    max_rsi: float = 70.0
    require_price_above_ema20: bool = True
    max_spy_drop_5m_pct: float = -0.3
    min_buy_hold_margin: float = 0.15
    confirmation_cycles: int = 2
    max_hold_minutes: float = 0.0
    jev_sell_exit_threshold: float = 0.75
    max_correlated_positions: int = 2
    warmup_min_1m_bars: int = 15
    min_news_sentiment: float = -0.3
    min_volume_ratio: float = 0.0
    min_share_price: float = 0.0
    news_block_tags: Tuple[str, ...] = (
        "downgrade",
        "lawsuit",
        "sec_investigation",
        "guidance_cut",
        "layoffs",
    )
    block_on_earnings: bool = False


def strategy_config_with_risk_overrides(
    base: StrategyConfig,
    *,
    min_volume_ratio: float,
    min_share_price: float = 0.0,
) -> StrategyConfig:
    """Apply dashboard settings overrides onto env-based strategy config."""
    return replace(
        base,
        min_volume_ratio=min_volume_ratio,
        min_share_price=min_share_price,
    )
