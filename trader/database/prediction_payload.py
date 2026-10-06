from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from models.types import JevPrediction, MarketState


def build_prediction_payload(
    state: MarketState,
    prediction: JevPrediction,
    *,
    trade_created: bool = False,
    trade_skip_reason: Optional[str] = None,
) -> dict:
    return {
        "symbol": prediction.symbol,
        "timestamp": prediction.timestamp.isoformat(),
        "price": state.price,
        "buy_probability": prediction.buy,
        "hold_probability": prediction.hold,
        "sell_probability": prediction.sell,
        "market_snapshot": state.to_dict(),
        "trade_created": trade_created,
        "trade_skip_reason": None if trade_created else trade_skip_reason,
    }


def build_filter_skip_payload(state: MarketState, reason: str) -> dict:
    """Record a hard-filter block without calling Jev.

    Zero probabilities are placeholders; treat rows with trade_skip_reason set as
    filter skips, not Jev outputs, when analyzing prediction history.
    """
    now = datetime.now(timezone.utc)
    return {
        "symbol": state.symbol,
        "timestamp": now.isoformat(),
        "price": state.price,
        "buy_probability": 0,
        "hold_probability": 0,
        "sell_probability": 0,
        "market_snapshot": state.to_dict(),
        "trade_created": False,
        "trade_skip_reason": reason,
    }
