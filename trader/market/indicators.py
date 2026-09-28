from __future__ import annotations

from typing import Optional

from market.history import HistoryStore, PriceHistory
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


def _volume_ratio(history: PriceHistory, window: int = 10) -> Optional[float]:
    volumes = history.volumes()
    if len(volumes) < window + 1:
        return None
    recent = volumes[-1]
    avg = sum(volumes[-window - 1 : -1]) / window
    if avg == 0:
        return None
    return round(recent / avg, 2)


def build_market_state(
    quote: Quote,
    history: HistoryStore,
    spy_history: PriceHistory,
    *,
    warmup_min_samples: int = 30,
    warmup_min_span_sec: float = 120.0,
) -> Optional[MarketState]:
    if quote.price is None:
        return None

    symbol_history = history.get(quote.symbol)
    if not symbol_history.is_ready(warmup_min_samples, warmup_min_span_sec):
        return None

    prices = symbol_history.prices()
    return MarketState(
        symbol=quote.symbol,
        price=quote.price,
        change_1m=symbol_history.change_pct(1),
        change_5m=symbol_history.change_pct(5),
        change_15m=symbol_history.change_pct(15),
        volume_ratio=_volume_ratio(symbol_history),
        rsi=_rsi(prices),
        ema_9=_ema(prices, 9),
        ema_20=_ema(prices, 20),
        bid=quote.bid,
        ask=quote.ask,
        spread=quote.spread,
        spy_change_5m=spy_history.change_pct(5),
    )
