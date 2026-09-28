from __future__ import annotations

import unittest

from risk.recommendations import RISK_SYNC_THRESHOLD, should_advance_baseline


class TestShouldAdvanceBaseline(unittest.TestCase):
    def test_rejects_non_positive_equity(self) -> None:
        self.assertFalse(should_advance_baseline(0, 1_000_000))
        self.assertFalse(should_advance_baseline(-100, 1_000_000))

    def test_initializes_when_baseline_missing(self) -> None:
        self.assertTrue(should_advance_baseline(1_000_000, None))
        self.assertTrue(should_advance_baseline(1_000_000, 0))

    def test_does_not_advance_within_threshold(self) -> None:
        baseline = 1_000_000
        self.assertFalse(should_advance_baseline(1_020_000, baseline, RISK_SYNC_THRESHOLD))
        self.assertFalse(should_advance_baseline(980_000, baseline, RISK_SYNC_THRESHOLD))

    def test_advances_at_threshold(self) -> None:
        baseline = 1_000_000
        self.assertTrue(should_advance_baseline(1_050_000, baseline, RISK_SYNC_THRESHOLD))
        self.assertTrue(should_advance_baseline(950_000, baseline, RISK_SYNC_THRESHOLD))

    def test_custom_threshold(self) -> None:
        baseline = 10_000
        self.assertFalse(should_advance_baseline(10_400, baseline, 0.05))
        self.assertTrue(should_advance_baseline(10_500, baseline, 0.05))


if __name__ == "__main__":
    unittest.main()
