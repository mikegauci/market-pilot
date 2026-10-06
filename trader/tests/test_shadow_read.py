import unittest
from datetime import datetime, timezone

from jev.shadow_read import should_shadow_read
from models.types import JevPrediction


class TestShouldShadowRead(unittest.TestCase):
    def test_record_tier_buy(self) -> None:
        prediction = JevPrediction(
            symbol="AAPL",
            buy=0.8,
            hold=0.15,
            sell=0.05,
            timestamp=datetime.now(timezone.utc),
        )
        self.assertTrue(should_shadow_read(prediction, record_threshold=0.75))

    def test_below_record_skips(self) -> None:
        prediction = JevPrediction(
            symbol="AAPL",
            buy=0.6,
            hold=0.3,
            sell=0.1,
            timestamp=datetime.now(timezone.utc),
        )
        self.assertFalse(should_shadow_read(prediction, record_threshold=0.75))

    def test_hold_dominant_skips(self) -> None:
        prediction = JevPrediction(
            symbol="AAPL",
            buy=0.4,
            hold=0.5,
            sell=0.1,
            timestamp=datetime.now(timezone.utc),
        )
        self.assertFalse(should_shadow_read(prediction, record_threshold=0.75))


if __name__ == "__main__":
    unittest.main()
