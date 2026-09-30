from __future__ import annotations

from typing import Optional

from models.types import JevPrediction


def resolve_gate_value(
    prediction: JevPrediction,
    gate_field: str = "buy_probability",
) -> tuple[Optional[float], Optional[str]]:
    """Return (gate_metric, skip_reason_if_unavailable).

    Default ``buy_probability`` matches historical behaviour (BUY-dominant buy %).
    ``confidence`` uses the optional API confidence field and fails closed if missing.
    """
    field = (gate_field or "buy_probability").strip().lower()
    if field == "confidence":
        if prediction.confidence is None:
            return None, "jev_confidence_missing"
        return float(prediction.confidence), None
    return float(prediction.buy), None


def signal_tier(
    prediction: JevPrediction,
    record_threshold: float,
    trade_threshold: float,
    min_buy_hold_margin: float = 0.0,
    *,
    gate_field: str = "buy_probability",
) -> str:
    """Classify the dominant Jev signal by gate-metric tier."""
    dominant = max(
        [("buy", prediction.buy), ("hold", prediction.hold), ("sell", prediction.sell)],
        key=lambda x: x[1],
    )
    side, dominant_prob = dominant

    if side != "buy":
        return f"{side.upper()} {dominant_prob:.0%} — IGNORE"

    gate_value, missing_reason = resolve_gate_value(prediction, gate_field)
    if missing_reason:
        return f"BUY — IGNORE ({missing_reason})"

    assert gate_value is not None
    if gate_value >= trade_threshold:
        if min_buy_hold_margin > 0 and (prediction.buy - prediction.hold) < min_buy_hold_margin:
            return f"BUY {gate_value:.0%} — IGNORE (margin)"
        return f"BUY {gate_value:.0%} — ELIGIBLE"
    if gate_value >= record_threshold:
        return f"BUY {gate_value:.0%} — RECORD"
    return f"BUY {gate_value:.0%} — IGNORE"


def is_trade_eligible(tier: str) -> bool:
    """True when Jev signal tier qualifies for a simulated trade entry."""
    return "ELIGIBLE" in tier


def trade_skip_reason_from_tier(tier: str) -> str:
    """Short code explaining why a signal tier did not qualify for entry."""
    if "jev_confidence_missing" in tier:
        return "jev_confidence_missing"
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


def should_spread_veto(
    prediction: JevPrediction,
    *,
    enabled: bool,
    max_stddev: float,
) -> bool:
    """True when multi-sample stddev exceeds the configured veto threshold."""
    if not enabled:
        return False
    if prediction.prob_stddev is None:
        return False
    return float(prediction.prob_stddev) > float(max_stddev)
