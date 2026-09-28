from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StrategyConfig:
    """Tightened entry/exit rules for Jev-driven day trading."""

    max_spread_pct: float = 0.0015
    max_rsi: float = 70.0
    require_price_above_ema20: bool = True
    max_spy_drop_5m_pct: float = -0.3
    min_buy_hold_margin: float = 0.15
    confirmation_cycles: int = 2
    max_hold_minutes: float = 15.0
    jev_sell_exit_threshold: float = 0.75
    max_correlated_positions: int = 2
    warmup_min_samples: int = 30
    warmup_min_span_sec: float = 120.0
