from __future__ import annotations

import threading
import time
import unittest

from runtime.periodic import periodic_callback


class PeriodicCallbackTests(unittest.TestCase):
    def test_invokes_callback_during_block(self) -> None:
        calls: list[int] = []
        lock = threading.Lock()

        def record() -> None:
            with lock:
                calls.append(1)

        with periodic_callback(0.05, record, name="test-pulse"):
            time.sleep(0.18)

        with lock:
            self.assertGreaterEqual(len(calls), 2)

    def test_stops_after_block(self) -> None:
        calls: list[int] = []
        lock = threading.Lock()

        def record() -> None:
            with lock:
                calls.append(1)

        with periodic_callback(0.05, record, name="test-pulse"):
            time.sleep(0.12)

        with lock:
            count_after_exit = len(calls)

        time.sleep(0.15)
        with lock:
            self.assertEqual(len(calls), count_after_exit)


if __name__ == "__main__":
    unittest.main()
