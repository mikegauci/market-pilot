from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional, Tuple

from strategy.ema_gate import EntryEmaGate, normalize_entry_ema_gate


@dataclass(frozen=True)
class StrategyConfig:
    """Tightened entry/exit rules for Jev-driven day trading."""

    max_spread_pct: float = 0.0015
    max_rsi: float = 70.0
    entry_ema_gate: EntryEmaGate = "ema_20"
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
    eod_flatten_minutes_before_close: float = 10.0
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
    # None = off. When set (e.g. 0.0), rotation excludes names below this session % vs RTH open.
    rotation_min_session_change_pct: Optional[float] = 0.0
    # Breakout trigger: pull a pool name into the active list the cycle it breaks out.
    breakout_enabled: bool = True
    breakout_lookback_minutes: int = 10
    breakout_min_volume_ratio: float = 1.5
    breakout_min_change_5m_pct: float = 0.15
    breakout_max_promotions_per_cycle: int = 2
    breakout_window_minutes: float = 10.0
    # RSI cap used instead of max_rsi while a name is inside its breakout window.
    breakout_max_rsi: float = 82.0


_ROTATION_OVERRIDE_UNSET = object()


def strategy_config_with_risk_overrides(
    base: StrategyConfig,
    *,
    min_volume_ratio: float,
    min_share_price: float = 0.0,
    min_dollar_volume: float = 0.0,
    jev_sell_exit_threshold: Optional[float] = None,
    confirmation_cycles: Optional[int] = None,
    confirmation_seconds: Optional[float] = None,
    rotation_min_session_change_pct: Optional[float] | object = _ROTATION_OVERRIDE_UNSET,
    entry_ema_gate: Optional[EntryEmaGate] = None,
    max_rsi: Optional[float] = None,
    max_spread_pct: Optional[float] = None,
) -> StrategyConfig:
    """Apply dashboard settings overrides onto env-based strategy config."""
    updates: dict = {
        "min_volume_ratio": min_volume_ratio,
        "min_share_price": min_share_price,
        "min_dollar_volume": min_dollar_volume,
    }
    if rotation_min_session_change_pct is not _ROTATION_OVERRIDE_UNSET:
        updates["rotation_min_session_change_pct"] = rotation_min_session_change_pct
    if jev_sell_exit_threshold is not None:
        updates["jev_sell_exit_threshold"] = jev_sell_exit_threshold
    if confirmation_cycles is not None:
        updates["confirmation_cycles"] = max(1, int(confirmation_cycles))
    if confirmation_seconds is not None:
        updates["confirmation_seconds"] = max(0.0, float(confirmation_seconds))
    if entry_ema_gate is not None:
        updates["entry_ema_gate"] = normalize_entry_ema_gate(entry_ema_gate)
    if max_rsi is not None:
        updates["max_rsi"] = float(max_rsi)
    if max_spread_pct is not None:
        updates["max_spread_pct"] = float(max_spread_pct)
    return replace(base, **updates)


def entry_ema_dashboard_override(
    *,
    from_settings: bool,
    value: object,
) -> dict[str, EntryEmaGate]:
    if not from_settings:
        return {}
    return {"entry_ema_gate": normalize_entry_ema_gate(value)}


def entry_rsi_spread_dashboard_overrides(
    *,
    max_rsi_from_settings: bool,
    max_rsi: float,
    max_spread_pct_from_settings: bool,
    max_spread_pct: float,
) -> dict[str, float]:
    updates: dict[str, float] = {}
    if max_rsi_from_settings:
        updates["max_rsi"] = float(max_rsi)
    if max_spread_pct_from_settings:
        updates["max_spread_pct"] = float(max_spread_pct)
    return updates


def rotation_dashboard_override(
    *,
    from_settings: bool,
    value: Optional[float],
) -> dict[str, Optional[float]]:
    """Apply Supabase rotation floor when the column was loaded; else keep env base."""
    if not from_settings:
        return {}
    return {"rotation_min_session_change_pct": value}
