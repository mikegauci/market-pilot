from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from market.hours import is_us_regular_session_open, seconds_until_next_open

ET = ZoneInfo("America/New_York")


def _et(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=ET)


class TestMarketHours(unittest.TestCase):
    def test_open_mid_session_tuesday(self) -> None:
        when = _et(2026, 9, 29, 10, 0)
        self.assertTrue(is_us_regular_session_open(when))

    def test_closed_after_hours(self) -> None:
        when = _et(2026, 9, 29, 17, 0)
        self.assertFalse(is_us_regular_session_open(when))

    def test_closed_before_open(self) -> None:
        when = _et(2026, 9, 29, 9, 0)
        self.assertFalse(is_us_regular_session_open(when))

    def test_closed_at_exact_close(self) -> None:
        when = _et(2026, 9, 29, 16, 0)
        self.assertFalse(is_us_regular_session_open(when))

    def test_closed_saturday(self) -> None:
        when = _et(2026, 9, 26, 12, 0)
        self.assertFalse(is_us_regular_session_open(when))

    def test_open_at_exact_open(self) -> None:
        when = _et(2026, 9, 29, 9, 30)
        self.assertTrue(is_us_regular_session_open(when))

    def test_seconds_until_next_open_when_closed(self) -> None:
        when = _et(2026, 9, 29, 17, 0)
        seconds = seconds_until_next_open(when)
        self.assertGreater(seconds, 0)
        self.assertLessEqual(seconds, 24 * 3600)

    def test_seconds_until_next_open_when_open(self) -> None:
        when = _et(2026, 9, 29, 11, 0)
        self.assertEqual(seconds_until_next_open(when), 0.0)


if __name__ == "__main__":
    unittest.main()
