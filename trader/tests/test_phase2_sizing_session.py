from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch

from market.hours import get_session_clock, is_us_regular_session_open, seconds_until_next_open
from risk.sizing import compute_position_sizing, paper_available_cash
from strategy.horizon import sanitize_horizon_eod_fields, validate_horizon_conflicts
from broker.eod import (
    entries_blocked_by_session,
    in_eod_closeout_window,
    in_eod_flat_verify_window,
)
from broker.symbol_locks import SymbolExitLocks

ET = ZoneInfo("America/New_York")


def _et(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=ET)


class TestPositionSizing(unittest.TestCase):
    def test_low_med_high_max_position_binds_at_1pct_stop(self) -> None:
        # Recommended fractions at $1M equity (see risk-recommendations).
        profiles = {
            "low": (1500.0, 3750.0),
            "medium": (2500.0, 5000.0),
            "high": (4000.0, 7500.0),
        }
        for name, (risk, max_pos) in profiles.items():
            result = compute_position_sizing(
                price=50.0,
                risk_per_trade=risk,
                stop_loss_percentage=0.01,
                max_position_size=max_pos,
                available_cash=1_000_000.0,
            )
            self.assertEqual(result.sizing_binding, "max_position", name)
            self.assertLess(result.planned_risk_usd, risk)
            self.assertGreaterEqual(result.quantity, 1)

    def test_cash_cap_and_too_small(self) -> None:
        result = compute_position_sizing(
            price=100.0,
            risk_per_trade=50.0,
            stop_loss_percentage=0.01,
            max_position_size=5000.0,
            available_cash=50.0,
        )
        self.assertEqual(result.sizing_binding, "too_small")
        self.assertFalse(result.ok)

    def test_paper_available_cash_ignores_broker(self) -> None:
        self.assertEqual(
            paper_available_cash(account_capital=10_000, deployed_notional=2_500),
            7_500.0,
        )


class TestHorizonValidation(unittest.TestCase):
    def test_force_eod_on_when_disabled(self) -> None:
        out = sanitize_horizon_eod_fields({"eod_closeout_enabled": False})
        self.assertTrue(out["eod_closeout_enabled"])

    def test_dangerous_combo_error(self) -> None:
        errors, _ = validate_horizon_conflicts(
            prediction_horizon_minutes=15,
            min_hold_minutes=15,
            max_hold_minutes=0,
            last_entry_cutoff_minutes_before_close=40,
            eod_closeout_enabled=False,
            eod_closeout_minutes_before_close=10,
            eod_flat_verify_minutes_before_close=5,
        )
        self.assertTrue(any("closeout" in e.lower() for e in errors))

    def test_cutoff_warnings(self) -> None:
        _, warnings = validate_horizon_conflicts(
            prediction_horizon_minutes=15,
            min_hold_minutes=15,
            max_hold_minutes=0,
            last_entry_cutoff_minutes_before_close=20,
            eod_closeout_enabled=True,
            eod_closeout_minutes_before_close=10,
            eod_flat_verify_minutes_before_close=5,
        )
        self.assertTrue(any("min hold" in w.lower() for w in warnings))
        self.assertTrue(any("horizon" in w.lower() for w in warnings))


class TestSessionClock(unittest.TestCase):
    def test_open_mid_session_tuesday(self) -> None:
        when = _et(2026, 9, 29, 10, 0)
        self.assertTrue(is_us_regular_session_open(when))

    def test_holiday_closed_thanksgiving_2025(self) -> None:
        when = _et(2025, 11, 27, 12, 0)
        clock = get_session_clock(when)
        self.assertFalse(clock.is_open)
        self.assertIsNone(clock.error)

    def test_early_close_day_before_july4_2025(self) -> None:
        # 2025-07-03 is Thursday early close (13:00 ET).
        when = _et(2025, 7, 3, 12, 30)
        clock = get_session_clock(when)
        self.assertTrue(clock.is_open)
        self.assertIsNotNone(clock.session_close_at)
        assert clock.session_close_at is not None
        self.assertEqual(clock.session_close_at.hour, 13)

    def test_early_close_after_1300_is_closed(self) -> None:
        when = _et(2025, 7, 3, 14, 0)
        clock = get_session_clock(when)
        self.assertFalse(clock.is_open)

    def test_dst_spring_forward_week_2026(self) -> None:
        # First Monday after DST spring forward 2026-03-08.
        when = _et(2026, 3, 9, 10, 0)
        clock = get_session_clock(when)
        self.assertTrue(clock.is_open)
        self.assertEqual(clock.session_open_at.hour, 9)

    def test_restart_inside_closeout_window_still_triggers(self) -> None:
        self.assertTrue(in_eod_closeout_window(9.5, 10, enabled=True))
        self.assertTrue(in_eod_flat_verify_window(4.0, 5))
        self.assertFalse(in_eod_closeout_window(11.0, 10, enabled=True))

    def test_last_entry_cutoff_blocks(self) -> None:
        reason = entries_blocked_by_session(
            minutes_to_close=30,
            last_entry_cutoff_minutes=40,
            session_fail_closed=False,
            session_is_open=True,
        )
        self.assertEqual(reason, "last_entry_cutoff")

    def test_calendar_error_fail_closed(self) -> None:
        reason = entries_blocked_by_session(
            minutes_to_close=None,
            last_entry_cutoff_minutes=40,
            session_fail_closed=True,
            session_is_open=False,
        )
        self.assertEqual(reason, "session_clock_error")

    def test_seconds_until_next_open_when_open(self) -> None:
        when = _et(2026, 9, 29, 11, 0)
        self.assertEqual(seconds_until_next_open(when), 0.0)

    def test_injectable_clock_closed_weekend(self) -> None:
        when = _et(2026, 9, 26, 12, 0)
        self.assertFalse(is_us_regular_session_open(when))


class TestSymbolExitLocks(unittest.TestCase):
    def test_per_symbol_serialize(self) -> None:
        locks = SymbolExitLocks()
        order: list[str] = []
        with locks.hold("AAPL"):
            order.append("a")
            with locks.hold("AAPL"):
                order.append("b")
        self.assertEqual(order, ["a", "b"])


if __name__ == "__main__":
    unittest.main()
