from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from runtime.shutdown_control import (
    HEARTBEAT_STALE_SEC,
    StartupShutdownAction,
    is_heartbeat_fresh,
    resolve_startup_entry_enabled,
    resolve_startup_shutdown_action,
)


class ShutdownControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 10, 5, 14, 0, 0, tzinfo=timezone.utc)

    def test_start_when_no_shutdown_flag(self) -> None:
        action = resolve_startup_shutdown_action(False, None, now=self.now)
        self.assertEqual(action, StartupShutdownAction.START)

    def test_exit_when_shutdown_and_fresh_heartbeat(self) -> None:
        hb = (self.now - timedelta(seconds=HEARTBEAT_STALE_SEC)).isoformat()
        action = resolve_startup_shutdown_action(True, hb, now=self.now)
        self.assertEqual(action, StartupShutdownAction.EXIT_PENDING_STOP)

    def test_block_when_shutdown_and_stale_heartbeat(self) -> None:
        hb = (self.now - timedelta(seconds=HEARTBEAT_STALE_SEC + 5)).isoformat()
        action = resolve_startup_shutdown_action(True, hb, now=self.now)
        self.assertEqual(action, StartupShutdownAction.BLOCK_UNTIL_CANCEL)

    def test_block_when_shutdown_and_no_heartbeat(self) -> None:
        action = resolve_startup_shutdown_action(True, None, now=self.now)
        self.assertEqual(action, StartupShutdownAction.BLOCK_UNTIL_CANCEL)

    def test_is_heartbeat_fresh_boundary(self) -> None:
        hb = (self.now - timedelta(seconds=HEARTBEAT_STALE_SEC)).isoformat()
        self.assertTrue(is_heartbeat_fresh(hb, now=self.now))
        stale = (self.now - timedelta(seconds=HEARTBEAT_STALE_SEC + 1)).isoformat()
        self.assertFalse(is_heartbeat_fresh(stale, now=self.now))

    def test_startup_entry_enabled_when_already_on(self) -> None:
        enabled, resumed = resolve_startup_entry_enabled(True)
        self.assertTrue(enabled)
        self.assertFalse(resumed)

    def test_startup_entry_enabled_resumes_offline_pause(self) -> None:
        enabled, resumed = resolve_startup_entry_enabled(False)
        self.assertTrue(enabled)
        self.assertTrue(resumed)


if __name__ == "__main__":
    unittest.main()
