from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone


HEARTBEAT_STALE_SEC = 30


def is_trader_online(last_heartbeat: datetime | None, now: datetime) -> bool:
    if last_heartbeat is None:
        return False
    age = (now - last_heartbeat).total_seconds()
    return age <= HEARTBEAT_STALE_SEC


def format_heartbeat_label(last_heartbeat: datetime, now: datetime) -> str:
    age = int(max(0, (now - last_heartbeat).total_seconds()))
    if age <= HEARTBEAT_STALE_SEC:
        if age < 5:
            return "Just now"
        if age < 60:
            return f"{age} seconds ago"
        return "1 minute ago"
    if age < 3600:
        minutes = age // 60
        if minutes == 0:
            return f"{age} seconds ago"
        return "1 minute ago" if minutes == 1 else f"{minutes} minutes ago"
    hours = age // 3600
    return "1 hour ago" if hours == 1 else f"{hours} hours ago"


class TestTraderStatusLogic(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 9, 28, 12, 0, 0, tzinfo=timezone.utc)

    def test_online_at_stale_threshold(self) -> None:
        heartbeat = self.now - timedelta(seconds=HEARTBEAT_STALE_SEC)
        self.assertTrue(is_trader_online(heartbeat, self.now))

    def test_offline_past_stale_threshold(self) -> None:
        heartbeat = self.now - timedelta(seconds=HEARTBEAT_STALE_SEC + 1)
        self.assertFalse(is_trader_online(heartbeat, self.now))

    def test_stale_label_uses_seconds_not_zero_minutes(self) -> None:
        heartbeat = self.now - timedelta(seconds=45)
        self.assertEqual(format_heartbeat_label(heartbeat, self.now), "45 seconds ago")


if __name__ == "__main__":
    unittest.main()
