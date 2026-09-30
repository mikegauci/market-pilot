"""Phase 7: Jev confidence parse, gate field, samples/veto, ceilings, model drift."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from unittest.mock import MagicMock

import pytest

from jev.client import average_predictions, extract_jev_confidence
from models.types import JevPrediction
from risk.model_drift import ModelDriftTracker
from risk.sanitize import (
    clamp_numeric,
    sanitize_gate_field,
    sanitize_phase7_fields,
)
from strategy.signals import (
    is_trade_eligible,
    should_spread_veto,
    signal_tier,
    trade_skip_reason_from_tier,
)


def _pred(
    *,
    buy: float = 0.9,
    hold: float = 0.05,
    sell: float = 0.05,
    confidence: float | None = None,
    stddev: float | None = None,
    samples: int = 1,
) -> JevPrediction:
    return JevPrediction(
        symbol="TEST",
        buy=buy,
        hold=hold,
        sell=sell,
        timestamp=datetime.now(timezone.utc),
        model="jev-test",
        confidence=confidence,
        samples_used=samples,
        prob_stddev=stddev,
    )


def test_extract_confidence_from_action_and_top_level() -> None:
    assert extract_jev_confidence({"answers": {"action": {"confidence": 0.77}}}) == 0.77
    assert extract_jev_confidence({"confidence": 0.66}) == 0.66
    assert extract_jev_confidence({"answers": {"action": {"probabilities": {"buy": 0.9}}}}) is None


def test_gate_buy_probability_matches_legacy_eligible() -> None:
    pred = _pred(buy=0.9, hold=0.05)
    tier = signal_tier(pred, 0.8, 0.85, 0.15, gate_field="buy_probability")
    assert is_trade_eligible(tier)
    assert "ELIGIBLE" in tier


def test_gate_confidence_uses_confidence_and_fails_closed() -> None:
    with_conf = _pred(buy=0.9, hold=0.05, confidence=0.9)
    tier_ok = signal_tier(with_conf, 0.8, 0.85, 0.15, gate_field="confidence")
    assert is_trade_eligible(tier_ok)

    missing = _pred(buy=0.9, hold=0.05, confidence=None)
    tier_miss = signal_tier(missing, 0.8, 0.85, 0.15, gate_field="confidence")
    assert not is_trade_eligible(tier_miss)
    assert trade_skip_reason_from_tier(tier_miss) == "jev_confidence_missing"

    low_conf = _pred(buy=0.9, hold=0.05, confidence=0.82)
    tier_low = signal_tier(low_conf, 0.8, 0.85, 0.15, gate_field="confidence")
    assert not is_trade_eligible(tier_low)
    assert trade_skip_reason_from_tier(tier_low) == "below_trade_threshold"


def test_average_predictions_and_spread_veto() -> None:
    samples: List[JevPrediction] = [
        _pred(buy=0.8, hold=0.1, sell=0.1, confidence=0.7),
        _pred(buy=0.9, hold=0.05, sell=0.05, confidence=0.8),
    ]
    avg = average_predictions(samples)
    assert avg.samples_used == 2
    assert abs(avg.buy - 0.85) < 1e-9
    assert avg.prob_stddev is not None and avg.prob_stddev > 0
    assert avg.confidence is not None
    assert abs(avg.confidence - 0.75) < 1e-9

    assert should_spread_veto(avg, enabled=False, max_stddev=0.01) is False
    assert should_spread_veto(avg, enabled=True, max_stddev=0.001) is True
    assert should_spread_veto(avg, enabled=True, max_stddev=1.0) is False


def test_sanitize_phase7_defaults_and_clamps(monkeypatch: pytest.MonkeyPatch) -> None:
    out = sanitize_phase7_fields({})
    assert out["jev_timeout_sec"] == 2.0
    assert out["jev_max_retries"] == 1
    assert out["jev_gate_field"] == "buy_probability"
    assert out["jev_samples"] == 1
    assert out["jev_spread_veto_enabled"] is False

    clamped = sanitize_phase7_fields(
        {
            "jev_timeout_sec": 30,
            "jev_max_retries": 9,
            "jev_samples": 99,
            "jev_gate_field": "nope",
        }
    )
    assert clamped["jev_timeout_sec"] == 5.0
    assert clamped["jev_max_retries"] == 2
    assert clamped["jev_samples"] == 5
    assert clamped["jev_gate_field"] == "buy_probability"
    assert sanitize_gate_field("confidence") == "confidence"

    monkeypatch.setenv("RISK_CEILING_JEV_TIMEOUT_SEC", "1.5")
    assert clamp_numeric("jev_timeout_sec", 4.0) == 1.5


def test_model_drift_alerts_once_per_utc_day() -> None:
    tracker = ModelDriftTracker()
    notifier = MagicMock()
    assert tracker.check(requested="jev-a", returned="jev-b", notifier=notifier) is True
    notifier.send.assert_called_once()
    assert "model drift" in notifier.send.call_args[0][0].lower()

    notifier.reset_mock()
    assert tracker.check(requested="jev-a", returned="jev-b", notifier=notifier) is False
    notifier.send.assert_not_called()

    assert tracker.check(requested="jev-a", returned="jev-a", notifier=notifier) is False
