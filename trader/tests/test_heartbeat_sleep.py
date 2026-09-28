from __future__ import annotations

import unittest

from main import compute_loop_sleep_sec


class TestComputeLoopSleep(unittest.TestCase):
    def test_overdue_heartbeat_returns_zero(self) -> None:
        sleep_for = compute_loop_sleep_sec(
            interval=300.0,
            elapsed=5.0,
            last_heartbeat_mono=100.0,
            now_mono=120.0,
            heartbeat_interval_sec=10.0,
            track_heartbeat=True,
        )
        self.assertEqual(sleep_for, 0.0)

    def test_caps_sleep_to_next_heartbeat(self) -> None:
        sleep_for = compute_loop_sleep_sec(
            interval=300.0,
            elapsed=0.0,
            last_heartbeat_mono=100.0,
            now_mono=105.0,
            heartbeat_interval_sec=10.0,
            track_heartbeat=True,
        )
        self.assertEqual(sleep_for, 5.0)

    def test_respects_eval_interval_when_shorter(self) -> None:
        sleep_for = compute_loop_sleep_sec(
            interval=30.0,
            elapsed=0.0,
            last_heartbeat_mono=100.0,
            now_mono=101.0,
            heartbeat_interval_sec=10.0,
            track_heartbeat=True,
        )
        self.assertEqual(sleep_for, 9.0)

    def test_skips_heartbeat_cap_when_disabled(self) -> None:
        sleep_for = compute_loop_sleep_sec(
            interval=300.0,
            elapsed=0.0,
            last_heartbeat_mono=100.0,
            now_mono=120.0,
            heartbeat_interval_sec=10.0,
            track_heartbeat=False,
        )
        self.assertEqual(sleep_for, 300.0)


if __name__ == "__main__":
    unittest.main()
