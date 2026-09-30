from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from market.hours import (
    ET,
    is_entry_window_open,
    is_us_regular_session_open,
    minutes_until_regular_close,
    should_force_eod_flatten,
)


class MarketHoursTests(unittest.TestCase):
    def test_regular_session_midday(self) -> None:
        when = datetime(2026, 9, 30, 12, 0, tzinfo=ET)
        self.assertTrue(is_us_regular_session_open(when))

    def test_weekend_closed(self) -> None:
        when = datetime(2026, 9, 26, 12, 0, tzinfo=ET)  # Saturday
        self.assertFalse(is_us_regular_session_open(when))

    def test_entry_window_closes_near_end(self) -> None:
        when = datetime(2026, 9, 30, 15, 50, tzinfo=ET)  # 10 min to close
        self.assertFalse(
            is_entry_window_open(when, cutoff_minutes_before_close=15.0)
        )
        when_ok = datetime(2026, 9, 30, 15, 0, tzinfo=ET)
        self.assertTrue(
            is_entry_window_open(when_ok, cutoff_minutes_before_close=15.0)
        )

    def test_eod_flatten_window_default_ten_minutes(self) -> None:
        when_in = datetime(2026, 9, 30, 15, 55, tzinfo=ET)
        self.assertTrue(should_force_eod_flatten(when_in))
        when_start = datetime(2026, 9, 30, 15, 50, tzinfo=ET)
        self.assertTrue(should_force_eod_flatten(when_start))
        when_early = datetime(2026, 9, 30, 15, 49, tzinfo=ET)
        self.assertFalse(should_force_eod_flatten(when_early))

    def test_eod_flatten_window_custom_cutoff(self) -> None:
        when = datetime(2026, 9, 30, 15, 57, tzinfo=ET)
        self.assertTrue(
            should_force_eod_flatten(when, flatten_minutes_before_close=5.0)
        )
        when_early = datetime(2026, 9, 30, 15, 50, tzinfo=ET)
        self.assertFalse(
            should_force_eod_flatten(when_early, flatten_minutes_before_close=5.0)
        )

    def test_minutes_until_close(self) -> None:
        when = datetime(2026, 9, 30, 15, 30, tzinfo=ET)
        self.assertEqual(minutes_until_regular_close(when), 30.0)


if __name__ == "__main__":
    unittest.main()
