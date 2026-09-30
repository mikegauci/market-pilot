from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

from models.types import MarketState, TradeRecord
from strategy.config import StrategyConfig
from strategy.correlation import count_china_factor_open, count_correlated_open


@dataclass(frozen=True)
class FilterResult:
    passed: bool
    reason: str = ""


def check_entry_filters(state: MarketState, config: StrategyConfig) -> FilterResult:
    if (
        config.min_dollar_volume > 0
        and state.avg_dollar_volume_5m is not None
        and state.avg_dollar_volume_5m < config.min_dollar_volume
    ):
        return FilterResult(
            False,
            f"dollar_volume_too_low ({state.avg_dollar_volume_5m:.0f} < {config.min_dollar_volume:.0f})",
        )

    if (
        config.min_share_price > 0
        and state.price < config.min_share_price
        and (config.min_dollar_volume <= 0 or state.avg_dollar_volume_5m is None)
    ):
        return FilterResult(
            False,
            f"price_too_low ({state.price:.2f} < {config.min_share_price:.2f})",
        )

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
    headwind_limit = config.max_benchmark_drop_5m_pct
    if headwind_limit == 0.0:
        headwind_limit = config.max_spy_drop_5m_pct
    if benchmark_change is not None and benchmark_change < headwind_limit:
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
    china_exposure = count_china_factor_open(open_symbols, symbol)
    if china_exposure > config.max_china_factor_positions:
        return FilterResult(
            False,
            f"china_factor_cap ({china_exposure} open)",
        )
    return FilterResult(True, "ok")
