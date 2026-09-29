from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

from models.types import MarketState, TradeRecord
from strategy.config import StrategyConfig
from strategy.correlation import count_correlated_open


@dataclass(frozen=True)
class FilterResult:
    passed: bool
    reason: str = ""


def check_entry_filters(state: MarketState, config: StrategyConfig) -> FilterResult:
    if state.spread is not None and state.price > 0:
        spread_pct = state.spread / state.price
        if spread_pct > config.max_spread_pct:
            return FilterResult(False, f"spread_too_wide ({spread_pct:.3%})")

    if state.rsi is not None and state.rsi > config.max_rsi:
        return FilterResult(False, f"rsi_overbought ({state.rsi:.1f})")

    if config.min_volume_ratio > 0 and state.volume_ratio is not None:
        if state.volume_ratio < config.min_volume_ratio:
            return FilterResult(
                False,
                f"volume_too_low ({state.volume_ratio:.2f} < {config.min_volume_ratio:.2f})",
            )

    if config.require_price_above_ema20 and state.ema_20 is not None:
        if state.price <= state.ema_20:
            return FilterResult(False, "price_below_ema20")

    benchmark_change = state.benchmark_change_5m
    if benchmark_change is None:
        benchmark_change = state.spy_change_5m
    if benchmark_change is not None and benchmark_change < config.max_spy_drop_5m_pct:
        return FilterResult(
            False,
            f"benchmark_headwind ({benchmark_change:.2f}% 5m)",
        )

    if state.news_sentiment is not None:
        if state.news_sentiment <= config.min_news_sentiment:
            return FilterResult(
                False,
                f"news_sentiment_bearish ({state.news_sentiment:.2f})",
            )

    if state.news_tags:
        blocked = set(config.news_block_tags) & set(state.news_tags)
        if blocked:
            tag = sorted(blocked)[0]
            return FilterResult(False, f"news_block_tag ({tag})")

        if config.block_on_earnings and "earnings" in state.news_tags:
            return FilterResult(False, "news_earnings_window")

    return FilterResult(True, "ok")


def check_correlation_cap(
    open_trades: Iterable[TradeRecord],
    symbol: str,
    config: StrategyConfig,
) -> FilterResult:
    open_symbols: List[str] = [t.symbol for t in open_trades]
    correlated = count_correlated_open(open_symbols, symbol)
    if correlated >= config.max_correlated_positions:
        return FilterResult(
            False,
            f"correlation_cap ({correlated} open in same group)",
        )
    return FilterResult(True, "ok")
