from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional, Tuple


@dataclass(frozen=True)
class StrategyConfig:
    """Tightened entry/exit rules for Jev-driven day trading."""

    max_spread_pct: float = 0.0015
    max_rsi: float = 70.0
    require_price_above_ema20: bool = True
    max_spy_drop_5m_pct: float = -0.3
    min_buy_hold_margin: float = 0.15
    confirmation_count: int = 2
    max_hold_minutes: float = 0.0
    jev_sell_exit_threshold: float = 0.95
    max_correlated_positions: int = 2
    warmup_min_1m_bars: int = 15
    min_news_sentiment: float = -0.3
    min_volume_ratio: float = 0.5
    min_share_price: float = 0.0
    news_block_tags: Tuple[str, ...] = (
        "downgrade",
        "lawsuit",
        "sec_investigation",
        "guidance_cut",
        "layoffs",
    )
    block_on_earnings: bool = False
    # Phase 10: individual veto toggles (default ON = preserve historical behaviour).
    buy_hold_margin_enabled: bool = True
    rsi_veto_enabled: bool = True
    price_floor_enabled: bool = True
    spread_filter_enabled: bool = True
    volume_filter_enabled: bool = True
    ema20_filter_enabled: bool = True
    benchmark_headwind_enabled: bool = True
    news_filters_enabled: bool = True
    correlation_cap_enabled: bool = True


def strategy_config_with_risk_overrides(
    base: StrategyConfig,
    *,
    min_volume_ratio: float,
    min_share_price: float = 0.0,
    jev_sell_exit_threshold: Optional[float] = None,
    buy_hold_margin_enabled: Optional[bool] = None,
    rsi_veto_enabled: Optional[bool] = None,
    price_floor_enabled: Optional[bool] = None,
    spread_filter_enabled: Optional[bool] = None,
    volume_filter_enabled: Optional[bool] = None,
    ema20_filter_enabled: Optional[bool] = None,
    benchmark_headwind_enabled: Optional[bool] = None,
    news_filters_enabled: Optional[bool] = None,
    correlation_cap_enabled: Optional[bool] = None,
) -> StrategyConfig:
    """Apply dashboard settings overrides onto env-based strategy config."""
    updates: dict = {
        "min_volume_ratio": min_volume_ratio,
        "min_share_price": min_share_price,
    }
    if jev_sell_exit_threshold is not None:
        updates["jev_sell_exit_threshold"] = jev_sell_exit_threshold
    for key, value in (
        ("buy_hold_margin_enabled", buy_hold_margin_enabled),
        ("rsi_veto_enabled", rsi_veto_enabled),
        ("price_floor_enabled", price_floor_enabled),
        ("spread_filter_enabled", spread_filter_enabled),
        ("volume_filter_enabled", volume_filter_enabled),
        ("ema20_filter_enabled", ema20_filter_enabled),
        ("benchmark_headwind_enabled", benchmark_headwind_enabled),
        ("news_filters_enabled", news_filters_enabled),
        ("correlation_cap_enabled", correlation_cap_enabled),
    ):
        if value is not None:
            updates[key] = value
    return replace(base, **updates)
