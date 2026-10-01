from __future__ import annotations

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
