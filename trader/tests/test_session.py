from __future__ import annotations

import unittest
from datetime import datetime, timezone

from market.bar_aggregator import MinuteBar
from market.bars import Bar
from market.hours import ET
from market.session import (
    rth_session_open_from_five_min_bars,
    session_change_pct_for_rotation,
    session_change_pct_from_bars,
)


class SessionChangeTests(unittest.TestCase):
    def test_session_change_from_rth_open(self) -> None:
        open_ts = datetime(2026, 10, 7, 9, 30, tzinfo=ET)
        later = datetime(2026, 10, 7, 10, 0, tzinfo=ET)
        bars = [
            MinuteBar(
                ts=open_ts.astimezone(timezone.utc),
                open=100.0,
                high=100.0,
                low=100.0,
                close=100.0,
                volume=1000,
            ),
            MinuteBar(
                ts=later.astimezone(timezone.utc),
                open=100.5,
                high=101.0,
                low=100.5,
                close=101.0,
                volume=1000,
            ),
        ]
        change = session_change_pct_from_bars(bars, 101.0, now=later)
        self.assertIsNotNone(change)
        assert change is not None
        self.assertAlmostEqual(change, 1.0, places=3)

    def test_five_min_cache_anchors_open_after_midday_restart(self) -> None:
        session_day = datetime(2026, 10, 7, 14, 0, tzinfo=ET)
        open_bar = Bar(
            symbol="NVDA",
            bar_size="5 mins",
            ts=datetime(2026, 10, 7, 9, 30, tzinfo=ET).astimezone(timezone.utc),
            open=200.0,
            high=201.0,
            low=199.5,
            close=200.5,
            volume=10_000,
        )
        later_bar = Bar(
            symbol="NVDA",
            bar_size="5 mins",
            ts=datetime(2026, 10, 7, 14, 0, tzinfo=ET).astimezone(timezone.utc),
            open=198.0,
            high=198.5,
            low=197.0,
            close=197.5,
            volume=8_000,
        )
        open_px = rth_session_open_from_five_min_bars(
            [later_bar, open_bar],
            now=session_day,
        )
        self.assertEqual(open_px, 200.0)
        change = session_change_pct_for_rotation(
            197.5,
            intraday_five_min_bars=[later_bar, open_bar],
            minute_aggregator=None,
            now=session_day,
        )
        self.assertIsNotNone(change)
        assert change is not None
        self.assertLess(change, 0)


if __name__ == "__main__":
    unittest.main()
