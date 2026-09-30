"""Phase 6: config fingerprint, slippage, MAE/MFE, multi-reason, forward return helpers."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from models.types import RiskSettings
from risk.config_version import fingerprint_risk_settings
from risk.execution_log import (
    compute_long_slippage,
    truncate_jev_raw,
    update_excursions,
)


def _risk(**overrides) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.7,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=5000.0,
        max_daily_loss=100.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10000.0,
        risk_sync_equity=None,
        watchlist=["AAPL"],
    )
    base.update(overrides)
    return RiskSettings(**base)


class TestConfigFingerprint(unittest.TestCase):
    def test_stable_for_same_settings(self) -> None:
        a = fingerprint_risk_settings(_risk())
        b = fingerprint_risk_settings(_risk())
        self.assertEqual(a[0], b[0])
        self.assertEqual(a[1], b[1])

    def test_changes_when_max_daily_loss_changes(self) -> None:
        h1, _ = fingerprint_risk_settings(_risk(max_daily_loss=100.0))
        h2, _ = fingerprint_risk_settings(_risk(max_daily_loss=200.0))
        self.assertNotEqual(h1, h2)


class TestSlippage(unittest.TestCase):
    def test_long_fill_above_decision_positive(self) -> None:
        slip = compute_long_slippage(
            decision_price=100.0, fill_price=100.5, quantity=10
        )
        self.assertAlmostEqual(slip, 5.0)

    def test_long_fill_below_decision_negative(self) -> None:
        slip = compute_long_slippage(
            decision_price=100.0, fill_price=99.0, quantity=10
        )
        self.assertAlmostEqual(slip, -10.0)

    def test_missing_decision_zero(self) -> None:
        self.assertEqual(
            compute_long_slippage(decision_price=None, fill_price=100.0, quantity=5),
            0.0,
        )


class TestMaeMfe(unittest.TestCase):
    def test_adverse_and_favorable_ticks(self) -> None:
        mae, mfe = update_excursions(
            entry_price=100.0, mark_price=98.0, mae=None, mfe=None
        )
        self.assertEqual(mae, -2.0)
        self.assertEqual(mfe, 0.0)
        mae2, mfe2 = update_excursions(
            entry_price=100.0, mark_price=103.0, mae=mae, mfe=mfe
        )
        self.assertEqual(mae2, -2.0)
        self.assertEqual(mfe2, 3.0)
        mae3, mfe3 = update_excursions(
            entry_price=100.0, mark_price=97.0, mae=mae2, mfe=mfe2
        )
        self.assertEqual(mae3, -3.0)
        self.assertEqual(mfe3, 3.0)


class TestMultiReasonOrder(unittest.TestCase):
    def test_first_reason_is_legacy(self) -> None:
        skip_reasons: list[str] = []
        trade_skip_reason = None

        def note(reason: str) -> None:
            nonlocal trade_skip_reason
            if reason not in skip_reasons:
                skip_reasons.append(reason)
            if trade_skip_reason is None:
                trade_skip_reason = reason

        note("entry_filter")
        note("correlation_cap")
        self.assertEqual(trade_skip_reason, "entry_filter")
        self.assertEqual(skip_reasons, ["entry_filter", "correlation_cap"])


class TestTruncateRaw(unittest.TestCase):
    def test_small_raw_passthrough(self) -> None:
        raw = {"model": "jev-latest", "answers": {"action": {}}}
        self.assertEqual(truncate_jev_raw(raw), raw)

    def test_huge_raw_truncated(self) -> None:
        raw = {"model": "x", "blob": "y" * 70_000}
        out = truncate_jev_raw(raw, max_chars=1000)
        self.assertTrue(out and out.get("_truncated"))


class TestForwardReturnMath(unittest.TestCase):
    def test_forward_return_frac(self) -> None:
        signal_price = 100.0
        forward_price = 102.0
        fwd = (forward_price - signal_price) / signal_price
        self.assertAlmostEqual(fwd, 0.02)
        # Timestamp horizon gate: older than horizon is eligible.
        signal_at = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        now = datetime(2026, 6, 15, 14, 20, tzinfo=timezone.utc)
        self.assertGreaterEqual((now - signal_at).total_seconds(), 15 * 60)


if __name__ == "__main__":
    unittest.main()
