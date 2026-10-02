from __future__ import annotations

import logging
from typing import Optional, Tuple

from models.types import TradeRecord

logger = logging.getLogger(__name__)

DEFAULT_PROFIT_TAKE_MIN = 0.70
DEFAULT_PROFIT_TAKE_MAX = 0.80


def take_profit_path_progress(trade: TradeRecord, price: float) -> Optional[float]:
    """Fraction of the entry→take-profit distance reached by price (0 = entry, 1 = TP)."""
    if trade.entry_price <= 0 or trade.take_profit <= trade.entry_price:
        return None
    span = trade.take_profit - trade.entry_price
    return (price - trade.entry_price) / span


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


def is_profit_take_eligible(
    trade: TradeRecord,
    price: float,
    *,
    enabled: bool,
    min_fraction: float,
    max_fraction: float,
) -> bool:
    if not enabled:
        return False
    min_fraction, max_fraction = normalize_profit_take_fractions(
        min_fraction, max_fraction
    )
    progress = take_profit_path_progress(trade, price)
    if progress is None or progress < 0:
        return False
    if min_fraction <= progress <= max_fraction:
        return True
    # Fast move skipped the band between quote cycles — still exit below full TP.
    return max_fraction < progress < 1.0
