from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from market.bar_aggregator import MinuteBarAggregator
from market.bars import TrendChanges
from models.types import MarketState, Quote


def _ema(prices: list[float], period: int) -> Optional[float]:
    if len(prices) < period:
        return None
    k = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    for price in prices[period:]:
        ema = price * k + ema * (1 - k)
    return round(ema, 4)


def _rsi(prices: list[float], period: int = 14) -> Optional[float]:
    if len(prices) < period + 1:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i - 1]
        gains.append(max(change, 0))
        losses.append(abs(min(change, 0)))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _volume_ratio_from_bars(volumes: list[int], window: int = 10) -> Optional[float]:
    if len(volumes) < window + 1:
        return None
    recent = volumes[-1]
    avg = sum(volumes[-window - 1 : -1]) / window
    if avg == 0:
        return None
    return round(recent / avg, 2)


@dataclass(frozen=True)
class IntradayIndicators:
    change_5m: Optional[float]
    change_15m: Optional[float]
    volume_ratio: Optional[float]
    rsi: Optional[float]
    ema_9: Optional[float]
    ema_20: Optional[float]


def compute_intraday_from_bars(
    aggregator: MinuteBarAggregator,
    live_price: float,
) -> IntradayIndicators:
    closes = aggregator.closes(live_price=live_price)
    volumes = aggregator.volumes()
    return IntradayIndicators(
        change_5m=aggregator.change_pct(5, live_price=live_price),
        change_15m=aggregator.change_pct(15, live_price=live_price),
        volume_ratio=_volume_ratio_from_bars(volumes),
        rsi=_rsi(closes),
        ema_9=_ema(closes, 9),
        ema_20=_ema(closes, 20),
    )


def build_market_state(
    quote: Quote,
    minute_bars: MinuteBarAggregator,
    benchmark_minute_bars: MinuteBarAggregator,
    *,
    trend_changes: Optional[TrendChanges] = None,
    warmup_min_1m_bars: int = 15,
) -> Optional[MarketState]:
    if quote.price is None:
        return None

    if not minute_bars.is_ready(warmup_min_1m_bars):
        return None

    intraday = compute_intraday_from_bars(minute_bars, quote.price)
    benchmark_change_5m = benchmark_minute_bars.change_pct(5)
    trends = trend_changes or TrendChanges()
    return MarketState(
        symbol=quote.symbol,
        price=quote.price,
        change_5m=intraday.change_5m,
        change_15m=intraday.change_15m,
        volume_ratio=intraday.volume_ratio,
        rsi=intraday.rsi,
        ema_9=intraday.ema_9,
        ema_20=intraday.ema_20,
        bid=quote.bid,
        ask=quote.ask,
        spread=quote.spread,
        spy_change_5m=benchmark_change_5m,
        change_1d=trends.change_1d,
        change_5d=trends.change_5d,
        change_1w=trends.change_1w,
        benchmark_change_5m=benchmark_change_5m,
    )
