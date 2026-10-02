from __future__ import annotations

import logging
from typing import Optional, Tuple

from models.types import JevPrediction, RiskSettings, TradeRecord
from watchlist.demotion import min_hold_remaining_minutes

logger = logging.getLogger(__name__)

DEFAULT_PROFIT_TAKE_MIN = 0.70
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
