from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence

from market.bar_aggregator import MinuteBarAggregator
from market.bars import Bar, TrendChanges
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
        non_zero = sum(1 for loss in losses[-period:] if loss > 0)
        if non_zero == 0:
            return None
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _volume_ratio_from_volumes(
    volumes: list[int],
    window: int = 10,
    *,
    partial_minute_elapsed: Optional[float] = None,
) -> Optional[float]:
    """Compare last completed bar volume to trailing average.

    When ``partial_minute_elapsed`` is set (0–1), the final volume is treated as
    an in-progress minute and scaled to a full-minute estimate.
    """
    if len(volumes) < window + 1:
        return None
    recent = volumes[-1]
    if partial_minute_elapsed is not None and 0 < partial_minute_elapsed < 1:
        recent = int(recent / partial_minute_elapsed)
    avg = sum(volumes[-window - 1 : -1]) / window
    if avg == 0:
        return None
    return round(recent / avg, 2)


def _volume_ratio_from_bars(
    volumes: list[int],
    window: int = 10,
    *,
    has_in_progress: bool = False,
    now: Optional[datetime] = None,
) -> Optional[float]:
    if not volumes:
        return None
    partial: Optional[float] = None
    if has_in_progress and now is not None:
        elapsed = now.second + now.microsecond / 1_000_000
        if elapsed > 0:
            partial = min(max(elapsed / 60.0, 0.05), 1.0)
    if has_in_progress and len(volumes) >= 2:
        completed = volumes[:-1]
        if len(completed) < window:
            return None
        recent = volumes[-1]
        if partial is not None:
            recent = int(recent / partial)
        avg = sum(completed[-window:]) / window
        if avg == 0:
            return None
        return round(recent / avg, 2)
    return _volume_ratio_from_volumes(volumes, window)


def _change_pct_from_closes(closes: list[float], bars_back: int) -> Optional[float]:
    if len(closes) <= bars_back:
        return None
    past = closes[-1 - bars_back]
    current = closes[-1]
    if past == 0:
        return None
    return round((current - past) / past * 100, 4)


def average_dollar_volume(bars: Sequence[Bar], window: int = 10) -> Optional[float]:
    if not bars:
        return None
    sorted_bars = sorted(bars, key=lambda item: item.ts)[-window:]
    if not sorted_bars:
        return None
    total = sum(bar.close * bar.volume for bar in sorted_bars)
    return total / len(sorted_bars)


def compute_atr_pct(bars: Sequence[Bar], period: int = 14) -> Optional[float]:
    """Average true range as a fraction of price (ATR / close)."""
    sorted_bars = sorted(bars, key=lambda item: item.ts)
    if len(sorted_bars) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(sorted_bars)):
        bar = sorted_bars[i]
        prev_close = sorted_bars[i - 1].close
        tr = max(
            bar.high - bar.low,
            abs(bar.high - prev_close),
            abs(bar.low - prev_close),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    atr = sum(trs[-period:]) / period
    close = sorted_bars[-1].close
    if close <= 0:
        return None
    return round(atr / close, 6)


@dataclass(frozen=True)
class IntradayIndicators:
    change_5m: Optional[float]
    change_15m: Optional[float]
    volume_ratio: Optional[float]
    rsi: Optional[float]
    ema_9: Optional[float]
    ema_20: Optional[float]


def compute_intraday_from_live_minute_bars(
    aggregator: MinuteBarAggregator,
    live_price: float,
    *,
    now: Optional[datetime] = None,
) -> IntradayIndicators:
    closes = aggregator.live_closes(live_price=live_price)
    volumes = aggregator.live_volumes()
    tick_now = now or datetime.now(timezone.utc)
    has_partial = aggregator.live_bar_count() > 0
    return IntradayIndicators(
        change_5m=aggregator.change_pct(5, live_price=live_price)
        if aggregator.live_bar_count() >= 6
        else _change_pct_from_closes(closes, 5),
        change_15m=aggregator.change_pct(15, live_price=live_price)
        if aggregator.live_bar_count() >= 16
        else _change_pct_from_closes(closes, 15),
        volume_ratio=_volume_ratio_from_bars(
            volumes,
            has_in_progress=has_partial and len(volumes) > 0,
            now=tick_now,
        ),
        rsi=_rsi(closes),
        ema_9=_ema(closes, 9),
        ema_20=_ema(closes, 20),
    )


def compute_intraday_from_bars(
    aggregator: MinuteBarAggregator,
    live_price: float,
) -> IntradayIndicators:
    """Legacy path — prefer ``compute_intraday_from_live_minute_bars`` for entries."""
    return compute_intraday_from_live_minute_bars(aggregator, live_price)


def compute_intraday_from_five_min_bars(
    bars: Sequence[Bar],
    live_price: float,
) -> IntradayIndicators:
    """Universe screener: true 5-minute OHLCV (not expanded 1-minute placeholders)."""
    sorted_bars = sorted(bars, key=lambda item: item.ts)
    if len(sorted_bars) < 2:
        return IntradayIndicators(None, None, None, None, None, None)
    closes = [bar.close for bar in sorted_bars]
    closes.append(live_price)
    volumes = [bar.volume for bar in sorted_bars]
    return IntradayIndicators(
        change_5m=_change_pct_from_closes(closes, 1),
        change_15m=_change_pct_from_closes(closes, 3),
        volume_ratio=_volume_ratio_from_volumes(volumes),
        rsi=_rsi(closes),
        ema_9=_ema(closes, 9),
        ema_20=_ema(closes, 20),
    )


def benchmark_change_from_five_min(bars: Sequence[Bar]) -> Optional[float]:
    sorted_bars = sorted(bars, key=lambda item: item.ts)
    if len(sorted_bars) < 2:
        return None
    closes = [bar.close for bar in sorted_bars]
    return _change_pct_from_closes(closes, 1)


def build_market_state(
    quote: Quote,
    minute_bars: MinuteBarAggregator,
    benchmark_minute_bars: Optional[MinuteBarAggregator],
    *,
    trend_changes: Optional[TrendChanges] = None,
    warmup_min_1m_bars: int = 15,
    min_live_1m_bars: int = 15,
    allow_five_min_fallback: bool = False,
    symbol_intraday_bars: Optional[Sequence[Bar]] = None,
    benchmark_intraday_bars: Optional[Sequence[Bar]] = None,
    benchmark_change_5m_override: Optional[float] = None,
) -> Optional[MarketState]:
    if quote.price is None:
        return None

    live_count = minute_bars.live_bar_count()
    cached_bars = list(symbol_intraday_bars or [])
    intraday: Optional[IntradayIndicators] = None

    if live_count >= min_live_1m_bars:
        intraday = compute_intraday_from_live_minute_bars(minute_bars, quote.price)
    elif allow_five_min_fallback and len(cached_bars) >= warmup_min_1m_bars:
        intraday = compute_intraday_from_five_min_bars(cached_bars, quote.price)
    else:
        return None

    if benchmark_change_5m_override is not None:
        benchmark_change_5m = benchmark_change_5m_override
    elif benchmark_intraday_bars:
        benchmark_change_5m = benchmark_change_from_five_min(benchmark_intraday_bars)
    elif benchmark_minute_bars is not None:
        benchmark_change_5m = benchmark_minute_bars.change_pct(5)
    else:
        benchmark_change_5m = None

    avg_dv = average_dollar_volume(cached_bars) if cached_bars else None
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
        avg_dollar_volume_5m=avg_dv,
    )

