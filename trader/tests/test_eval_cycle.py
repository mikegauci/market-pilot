from __future__ import annotations

from datetime import datetime, timezone

from database.prediction_payload import build_prediction_payload
from models.types import JevPrediction, MarketState
from strategy.confirmation import ConfirmationTracker
from strategy.signals import (
    is_trade_eligible,
    trade_skip_reason_from_tier,
)


def _market_state() -> MarketState:
    return MarketState(
        symbol="NU",
        price=10.0,
        change_5m=0.1,
        change_15m=0.2,
        volume_ratio=1.0,
        rsi=50.0,
        ema_9=9.8,
        ema_20=9.5,
        bid=9.99,
        ask=10.01,
        spread=0.02,
        spy_change_5m=-0.05,
    )


def test_skip_reason_from_tier_eligible_path() -> None:
    tier = "BUY 90% — ELIGIBLE"
    assert is_trade_eligible(tier)
    assert trade_skip_reason_from_tier("BUY 80% — RECORD") == "below_trade_threshold"
    assert trade_skip_reason_from_tier("HOLD 70% — IGNORE") == "hold_dominant"


def test_confirmation_gate_blocks_until_cycles_and_seconds() -> None:
    tracker = ConfirmationTracker(required_cycles=2, required_seconds=30.0)
    assert tracker.record("NU", True) is False
    assert tracker.record("NU", True) is False
    tracker._first_eligible_mono["NU"] = tracker._first_eligible_mono["NU"] - 31.0
    assert tracker.record("NU", True) is True


def test_prediction_payload_records_skip_reason_when_not_traded() -> None:
    state = _market_state()
    prediction = JevPrediction(
        symbol="NU",
        buy=0.5,
        hold=0.3,
        sell=0.2,
        timestamp=datetime.now(timezone.utc),
    )
    payload = build_prediction_payload(
        state,
        prediction,
        trade_created=False,
        trade_skip_reason="spread_too_wide (0.200%)",
    )
    assert payload["trade_created"] is False
    assert payload["trade_skip_reason"] == "spread_too_wide (0.200%)"


def test_prediction_payload_clears_skip_reason_on_trade() -> None:
    state = _market_state()
    prediction = JevPrediction(
        symbol="NU",
        buy=0.9,
        hold=0.05,
        sell=0.05,
        timestamp=datetime.now(timezone.utc),
    )
    payload = build_prediction_payload(
        state,
        prediction,
        trade_created=True,
        trade_skip_reason="should_be_ignored",
    )
    assert payload["trade_created"] is True
    assert payload["trade_skip_reason"] is None
