from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

from models.types import JevPrediction, Quote, RiskSettings, TradeRecord

logger = logging.getLogger(__name__)

DEFAULT_PROFIT_TAKE_MIN = 0.70


def min_hold_remaining_minutes(
    trade: TradeRecord,
    risk_settings: RiskSettings,
    *,
    now: Optional[datetime] = None,
) -> float:
    """Minutes left before a Jev SELL soft-exit is allowed (0 when eligible)."""
    min_hold = float(getattr(risk_settings, "min_hold_minutes", 0) or 0)
    if min_hold <= 0:
        return 0.0

    entry = trade.entry_time
    if entry.tzinfo is None:
        entry = entry.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    held_minutes = (current - entry).total_seconds() / 60.0
    return max(0.0, min_hold - held_minutes)


def price_between_entry_and_take_profit(trade: TradeRecord, price: float) -> bool:
    """True when price is above entry but still below the take-profit level."""
    if trade.entry_price <= 0 or trade.take_profit <= trade.entry_price:
        return False
    return trade.entry_price < price < trade.take_profit


def jev_sell_exit_allowed(
    trade: TradeRecord,
    risk_settings: RiskSettings,
    quote: Optional[Quote],
    *,
    now: Optional[datetime] = None,
) -> bool:
    if quote is None or quote.price is None:
        return False

    if min_hold_remaining_minutes(trade, risk_settings, now=now) > 0:
        return False

    if price_between_entry_and_take_profit(trade, quote.price):
        return False

    pnl = (quote.price - trade.entry_price) * trade.quantity
    return pnl >= 0


DEFAULT_PROFIT_TAKE_MAX = 0.80
DEFAULT_PROFIT_TAKE_MIN_BAND_HITS = 3
DEFAULT_PROFIT_TAKE_BAND_WINDOW = 10
DEFAULT_PROFIT_TAKE_JEV_SELL_THRESHOLD = 0.70


def take_profit_path_progress(trade: TradeRecord, price: float) -> Optional[float]:
    """Fraction of the entry→take-profit distance reached by price (0 = entry, 1 = TP)."""
    if trade.entry_price <= 0 or trade.take_profit <= trade.entry_price:
        return None
    span = trade.take_profit - trade.entry_price
    return (price - trade.entry_price) / span


DEFAULT_LOSS_CUT_MIN = 0.70
DEFAULT_LOSS_CUT_MAX = 0.90


def stop_loss_path_progress(trade: TradeRecord, price: float) -> Optional[float]:
    """Fraction of entry→stop distance when underwater (0 = entry, 1 = hard stop)."""
    if trade.entry_price <= 0 or trade.stop_loss >= trade.entry_price:
        return None
    if price >= trade.entry_price:
        return None
    span = trade.entry_price - trade.stop_loss
    if price <= trade.stop_loss:
        return 1.0
    return (trade.entry_price - price) / span


def normalize_profit_take_band_hits(min_hits: int, window_cycles: int) -> int:
    """Ensure band-touch requirement fits the rolling window."""
    hits = max(1, int(min_hits or 1))
    window = max(1, int(window_cycles or 1))
    if hits > window:
        logger.warning(
            "profit_take_min_band_hits (%s) > window (%s) — using %s",
            hits,
            window,
            window,
        )
        return window
    return hits


def normalize_profit_take_fractions(
    min_fraction: float,
    max_fraction: float,
) -> Tuple[float, float]:
    """Clamp invalid DB values to safe defaults."""
    min_f = float(min_fraction)
    max_f = float(max_fraction)
    valid = (
        0 < min_f < 1
        and 0 < max_f <= 1
        and max_f > min_f
    )
    if not valid:
        logger.warning(
            "Invalid profit_take fractions (min=%.4f max=%.4f) — using %.2f/%.2f",
            min_f,
            max_f,
            DEFAULT_PROFIT_TAKE_MIN,
            DEFAULT_PROFIT_TAKE_MAX,
        )
        return DEFAULT_PROFIT_TAKE_MIN, DEFAULT_PROFIT_TAKE_MAX
    return min_f, max_f


def progress_in_band(progress: float, min_fraction: float, max_fraction: float) -> bool:
    return min_fraction <= progress <= max_fraction


def is_fast_spike_exit(progress: float, max_fraction: float) -> bool:
    """Fast move skipped the band between quote cycles — still exit below full TP."""
    return max_fraction < progress < 1.0


def is_soft_jev_profit_take(
    prediction: Optional[JevPrediction],
    threshold: float,
    *,
    min_progress: float,
    progress: Optional[float],
) -> bool:
    if prediction is None or progress is None or progress < min_progress:
        return False
    if threshold <= 0:
        return False
    dominant = max(
        [("buy", prediction.buy), ("hold", prediction.hold), ("sell", prediction.sell)],
        key=lambda x: x[1],
    )
    side, confidence = dominant
    return side == "sell" and confidence >= threshold


def profit_take_should_exit(
    trade: TradeRecord,
    price: float,
    settings: RiskSettings,
    *,
    band_hits: int,
    prediction: Optional[JevPrediction] = None,
) -> bool:
    if not settings.profit_take_enabled:
        return False
    if min_hold_remaining_minutes(trade, settings) > 0:
        return False

    min_fraction, max_fraction = normalize_profit_take_fractions(
        settings.profit_take_min_fraction,
        settings.profit_take_max_fraction,
    )
    progress = take_profit_path_progress(trade, price)
    if progress is None or progress < 0:
        return False

    if is_fast_spike_exit(progress, max_fraction):
        return True

    min_hits = normalize_profit_take_band_hits(
        getattr(settings, "profit_take_min_band_hits", 1),
        getattr(settings, "profit_take_band_window_cycles", 10),
    )
    # Enough band touches in the window while still in profit below full TP (not only on
    # the exact current tick inside [min, max] — allows exit after brief dip e.g. 67→71).
    if (
        band_hits >= min_hits
        and min_fraction <= progress < 1.0
    ):
        return True

    jev_threshold = float(
        getattr(settings, "profit_take_jev_sell_threshold", 0) or 0
    )
    if is_soft_jev_profit_take(
        prediction,
        jev_threshold,
        min_progress=min_fraction,
        progress=progress,
    ):
        return True

    return False


def is_profit_take_eligible(
    trade: TradeRecord,
    price: float,
    *,
    enabled: bool,
    min_fraction: float,
    max_fraction: float,
) -> bool:
    """Legacy one-shot check (band touch or fast spike). Prefer profit_take_should_exit."""
    if not enabled:
        return False
    min_fraction, max_fraction = normalize_profit_take_fractions(
        min_fraction, max_fraction
    )
    progress = take_profit_path_progress(trade, price)
    if progress is None or progress < 0:
        return False
    if progress_in_band(progress, min_fraction, max_fraction):
        return True
    return is_fast_spike_exit(progress, max_fraction)


def normalize_loss_cut_fractions(
    min_fraction: float,
    max_fraction: float,
) -> Tuple[float, float]:
    """Clamp invalid DB values to safe defaults."""
    min_f = float(min_fraction)
    max_f = float(max_fraction)
    valid = (
        0 < min_f < 1
        and 0 < max_f <= 1
        and max_f > min_f
    )
    if not valid:
        logger.warning(
            "Invalid loss_cut fractions (min=%.4f max=%.4f) — using %.2f/%.2f",
            min_f,
            max_f,
            DEFAULT_LOSS_CUT_MIN,
            DEFAULT_LOSS_CUT_MAX,
        )
        return DEFAULT_LOSS_CUT_MIN, DEFAULT_LOSS_CUT_MAX
    return min_f, max_f


def normalize_loss_cut_band_hits(min_hits: int, window_cycles: int) -> int:
    """Ensure band-touch requirement fits the rolling window."""
    return normalize_profit_take_band_hits(min_hits, window_cycles)


def is_soft_jev_loss_cut(
    prediction: Optional[JevPrediction],
    threshold: float,
    *,
    min_progress: float,
    progress: Optional[float],
) -> bool:
    return is_soft_jev_profit_take(
        prediction,
        threshold,
        min_progress=min_progress,
        progress=progress,
    )


def loss_cut_should_exit(
    trade: TradeRecord,
    price: float,
    settings: RiskSettings,
    *,
    band_hits: int,
    prediction: Optional[JevPrediction] = None,
) -> bool:
    if not settings.loss_cut_enabled:
        return False
    if min_hold_remaining_minutes(trade, settings) > 0:
        return False

    min_fraction, max_fraction = normalize_loss_cut_fractions(
        settings.loss_cut_min_fraction,
        settings.loss_cut_max_fraction,
    )
    progress = stop_loss_path_progress(trade, price)
    if progress is None or progress <= 0:
        return False

    if is_fast_spike_exit(progress, max_fraction):
        return True

    min_hits = normalize_loss_cut_band_hits(
        getattr(settings, "loss_cut_min_band_hits", 1),
        getattr(settings, "loss_cut_band_window_cycles", 10),
    )
    if band_hits >= min_hits and min_fraction <= progress < 1.0:
        return True

    jev_threshold = float(getattr(settings, "loss_cut_jev_sell_threshold", 0) or 0)
    if is_soft_jev_loss_cut(
        prediction,
        jev_threshold,
        min_progress=min_fraction,
        progress=progress,
    ):
        return True

    return False
