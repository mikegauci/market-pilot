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
    max_benchmark_drop_5m_pct: float = -0.12
    min_buy_hold_margin: float = 0.15
    confirmation_cycles: int = 2
    max_hold_minutes: float = 0.0
    jev_sell_exit_threshold: float = 0.95
    max_correlated_positions: int = 2
    max_china_factor_positions: int = 3
    warmup_min_1m_bars: int = 15
    min_live_1m_bars_open: int = 3
    min_news_sentiment: float = -0.3
    min_volume_ratio: float = 0.5
    min_share_price: float = 0.0
    min_dollar_volume: float = 0.0
    min_buy_sell_margin: float = 0.10
    confirmation_seconds: float = 30.0
    entry_cutoff_minutes_before_close: float = 15.0
    eod_flatten_minutes_before_close: float = 5.0
    stop_loss_atr_multiple: float = 1.0
    take_profit_atr_multiple: float = 1.5
    min_stop_loss_pct: float = 0.003
    max_stop_loss_pct: float = 0.02
    min_take_profit_pct: float = 0.004
    max_take_profit_pct: float = 0.03
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
    min_dollar_volume: float = 0.0,
    jev_sell_exit_threshold: Optional[float] = None,
) -> StrategyConfig:
    """Apply dashboard settings overrides onto env-based strategy config."""
    updates: dict = {
        "min_volume_ratio": min_volume_ratio,
        "min_share_price": min_share_price,
        "min_dollar_volume": min_dollar_volume,
    }
    if jev_sell_exit_threshold is not None:
        updates["jev_sell_exit_threshold"] = jev_sell_exit_threshold
    return replace(base, **updates)
