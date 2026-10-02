from __future__ import annotations

import unittest

from strategy.profit_take_tracker import ProfitTakeBandTracker


class TestProfitTakeBandTracker(unittest.TestCase):
    def test_counts_band_hits_in_window(self) -> None:
        tracker = ProfitTakeBandTracker(window_cycles=5)
        self.assertEqual(tracker.record("t1", True), 1)
        self.assertEqual(tracker.record("t1", False), 1)
        self.assertEqual(tracker.record("t1", True), 2)
        self.assertEqual(tracker.record("t1", True), 3)

    def test_window_rolls_off_old_samples(self) -> None:
        tracker = ProfitTakeBandTracker(window_cycles=3)
        tracker.record("t1", True)
        tracker.record("t1", True)
        tracker.record("t1", False)
        self.assertEqual(tracker.record("t1", False), 1)
        tracker.record("t1", False)
        self.assertEqual(tracker.record("t1", False), 0)

    def test_prune_removes_closed_trades(self) -> None:
        tracker = ProfitTakeBandTracker(window_cycles=5)
        tracker.record("gone", True)
        tracker.prune({"open"})
        self.assertEqual(tracker.record("gone", True), 1)


if __name__ == "__main__":
    unittest.main()
