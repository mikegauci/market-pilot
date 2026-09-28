from __future__ import annotations

import unittest
from datetime import datetime, timezone

from database.supabase import _parse_timestamp


class TestParseTimestamp(unittest.TestCase):
    def test_postgres_five_digit_fraction(self) -> None:
        parsed = _parse_timestamp("2026-09-28T14:02:50.99074+00:00")
        self.assertEqual(parsed.tzinfo, timezone.utc)
        self.assertEqual(parsed.year, 2026)
        self.assertEqual(parsed.month, 9)
        self.assertEqual(parsed.day, 28)
        self.assertEqual(parsed.hour, 14)
        self.assertEqual(parsed.minute, 2)
        self.assertEqual(parsed.second, 50)
        self.assertEqual(parsed.microsecond, 990740)

    def test_z_suffix(self) -> None:
        parsed = _parse_timestamp("2026-09-28T14:02:50.123Z")
        self.assertEqual(parsed.tzinfo, timezone.utc)
        self.assertEqual(parsed.microsecond, 123000)

    def test_datetime_passthrough(self) -> None:
        dt = datetime(2026, 9, 28, 14, 2, 50, tzinfo=timezone.utc)
        self.assertIs(_parse_timestamp(dt), dt)


if __name__ == "__main__":
    unittest.main()
