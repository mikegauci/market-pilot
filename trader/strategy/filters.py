from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Tuple

from models.types import MarketState, TradeRecord
from strategy.config import StrategyConfig
from strategy.correlation import count_correlated_open


@dataclass(frozen=True)
class FilterResult:
    passed: bool
    reason: str = ""
    reasons: Tuple[str, ...] = ()


def _collect_entry_failures(state: MarketState, config: StrategyConfig) -> List[str]:
    """Return every hard-filter failure (not just the first)."""
    failures: List[str] = []

    if (
        config.price_floor_enabled
        and config.min_share_price > 0
        and state.price < config.min_share_price
    ):
        failures.append(
            f"price_too_low ({state.price:.2f} < {config.min_share_price:.2f})"
        )

    if config.spread_filter_enabled and state.spread is not None and state.price > 0:
        spread_pct = state.spread / state.price
        if spread_pct > config.max_spread_pct:
            failures.append(f"spread_too_wide ({spread_pct:.3%})")

    if (
        config.rsi_veto_enabled
        and state.rsi is not None
        and state.rsi > config.max_rsi
    ):
        failures.append(f"rsi_overbought ({state.rsi:.1f})")

    if (
        config.volume_filter_enabled
        and config.min_volume_ratio > 0
        and state.volume_ratio is not None
        and state.volume_ratio < config.min_volume_ratio
    ):
        failures.append(
            f"volume_too_low ({state.volume_ratio:.2f} < {config.min_volume_ratio:.2f})"
        )

    if (
        config.ema20_filter_enabled
        and config.require_price_above_ema20
        and state.ema_20 is not None
        and state.price <= state.ema_20
    ):
        failures.append("price_below_ema20")

    if config.benchmark_headwind_enabled:
        benchmark_change = state.benchmark_change_5m
        if benchmark_change is None:
            benchmark_change = state.spy_change_5m
        if (
            benchmark_change is not None
            and benchmark_change < config.max_spy_drop_5m_pct
        ):
            failures.append(f"benchmark_headwind ({benchmark_change:.2f}% 5m)")

    if config.news_filters_enabled:
        if state.news_sentiment is not None:
            if state.news_sentiment <= config.min_news_sentiment:
                failures.append(
                    f"news_sentiment_bearish ({state.news_sentiment:.2f})"
                )

        if state.news_tags:
            blocked = set(config.news_block_tags) & set(state.news_tags)
            if blocked:
                tag = sorted(blocked)[0]
                failures.append(f"news_block_tag ({tag})")

            if config.block_on_earnings and "earnings" in state.news_tags:
                failures.append("news_earnings_window")

    return failures


def check_entry_filters(state: MarketState, config: StrategyConfig) -> FilterResult:
    failures = _collect_entry_failures(state, config)
    if not failures:
        return FilterResult(True, "ok", ())
    return FilterResult(False, failures[0], tuple(failures))


def check_correlation_cap(
    open_trades: Iterable[TradeRecord],
    symbol: str,
    config: StrategyConfig,
) -> FilterResult:
    if not config.correlation_cap_enabled:
        return FilterResult(True, "ok", ())
    open_symbols: List[str] = [t.symbol for t in open_trades]
    correlated = count_correlated_open(open_symbols, symbol)
    if correlated >= config.max_correlated_positions:
        reason = f"correlation_cap ({correlated} open in same group)"
        return FilterResult(False, reason, (reason,))
    return FilterResult(True, "ok", ())
