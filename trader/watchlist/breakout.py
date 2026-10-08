"""Spot 1-minute breakouts in pool names so they reach the active list before the move is over."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Mapping, Optional, Set

from market.bar_aggregator import MinuteBarAggregator
from strategy.config import StrategyConfig

MIN_BASELINE_VOLUME_BARS = 5


@dataclass(frozen=True)
class BreakoutSignal:
    symbol: str
    price: float
    prior_high: float
    change_5m: float
    volume_ratio: float


def detect_breakout(
    symbol: str,
    aggregator: Optional[MinuteBarAggregator],
    price: Optional[float],
    config: StrategyConfig,
    *,
    benchmark_change_5m: Optional[float] = None,
) -> Optional[BreakoutSignal]:
    """Price above the prior N-minute high, on a volume spike, outrunning the benchmark."""
    if aggregator is None or price is None or price <= 0:
        return None
    lookback = max(2, int(config.breakout_lookback_minutes))
    bars = [bar for bar in aggregator.all_bars() if not bar.synthetic]
    if len(bars) < lookback + 1:
        return None
    prior_high = max(bar.high for bar in bars[-(lookback + 1) : -1])
    if price <= prior_high:
        return None

    change_5m = aggregator.change_pct(5, price)
    if change_5m is None or change_5m < config.breakout_min_change_5m_pct:
        return None
    if benchmark_change_5m is not None and change_5m <= benchmark_change_5m:
        return None

    # Seeded history uses different volume units than live ticks, so only live bars count.
    live = [bar for bar in bars if not bar.seeded]
    baseline = live[-(lookback + 2) : -2]
    if len(baseline) < MIN_BASELINE_VOLUME_BARS:
        return None
    baseline_avg = sum(bar.volume for bar in baseline) / len(baseline)
    if baseline_avg <= 0:
        return None
    recent = max(live[-1].volume, live[-2].volume)
    volume_ratio = recent / baseline_avg
    if volume_ratio < config.breakout_min_volume_ratio:
        return None

    return BreakoutSignal(
        symbol=symbol.upper(),
        price=price,
        prior_high=prior_high,
        change_5m=change_5m,
        volume_ratio=volume_ratio,
    )


def active_breakout_symbols(
    breakout_until_mono: Mapping[str, float],
    now_mono: float,
) -> Set[str]:
    return {symbol for symbol, until in breakout_until_mono.items() if until > now_mono}


def breakout_entry_config(
    config: StrategyConfig,
    symbol: str,
    breakout_until_mono: Mapping[str, float],
    now_mono: float,
) -> StrategyConfig:
    """Entry gates for one symbol: a looser RSI cap while it is inside its breakout window."""
    if symbol.upper() not in active_breakout_symbols(breakout_until_mono, now_mono):
        return config
    if config.breakout_max_rsi <= config.max_rsi:
        return config
    return replace(config, max_rsi=config.breakout_max_rsi)
