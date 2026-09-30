from __future__ import annotations

from models.types import JevPrediction


def signal_tier(
    prediction: JevPrediction,
    record_threshold: float,
    trade_threshold: float,
    min_buy_hold_margin: float = 0.0,
    min_buy_sell_margin: float = 0.0,
) -> str:
    """Classify the dominant Jev signal by confidence tier."""
    dominant = max(
        [("buy", prediction.buy), ("hold", prediction.hold), ("sell", prediction.sell)],
        key=lambda x: x[1],
    )
    side, confidence = dominant

    if side != "buy":
        return f"{side.upper()} {confidence:.0%} — IGNORE"

    if confidence >= trade_threshold:
        if min_buy_sell_margin > 0 and (prediction.buy - prediction.sell) < min_buy_sell_margin:
            return f"BUY {confidence:.0%} — IGNORE (margin)"
        if min_buy_hold_margin > 0 and (prediction.buy - prediction.hold) < min_buy_hold_margin:
            return f"BUY {confidence:.0%} — IGNORE (margin)"
        return f"BUY {confidence:.0%} — ELIGIBLE"
    if confidence >= record_threshold:
        return f"BUY {confidence:.0%} — RECORD"
    return f"BUY {confidence:.0%} — IGNORE"


def is_trade_eligible(tier: str) -> bool:
    """True when Jev signal tier qualifies for a simulated trade entry."""
    return "ELIGIBLE" in tier


def trade_skip_reason_from_tier(tier: str) -> str:
    """Short code explaining why a signal tier did not qualify for entry."""
    if "IGNORE (margin)" in tier:
        return "buy_hold_margin"
    if "RECORD" in tier:
        return "below_trade_threshold"
    if tier.startswith("HOLD"):
        return "hold_dominant"
    if tier.startswith("SELL"):
        return "sell_dominant"
    return "signal_not_eligible"


def is_sell_exit_eligible(prediction: JevPrediction, threshold: float) -> bool:
    """True when SELL is dominant and meets the exit confidence threshold."""
    dominant = max(
        [("buy", prediction.buy), ("hold", prediction.hold), ("sell", prediction.sell)],
        key=lambda x: x[1],
    )
    side, confidence = dominant
    return side == "sell" and confidence >= threshold
