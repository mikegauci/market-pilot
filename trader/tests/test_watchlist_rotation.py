from __future__ import annotations

import unittest

from market.session import SESSION_DISQUALIFIED_SCORE
from watchlist.rotation import (
    RotationCandidate,
    backfill_order,
    capped_active_size,
    rotate_active,
    score_candidate,
)


class RotationScoreTests(unittest.TestCase):
    def test_overbought_ranks_below_a_calmer_leader(self) -> None:
        hot = score_candidate(
            RotationCandidate("NVDA", change_5m=1.2, change_15m=2.0, rsi=78, price=100, ema_20=90),
            benchmark_change_5m=0.1,
            benchmark_change_15m=0.2,
            min_volume_ratio=0.5,
            max_rsi=70,
        )
        calm = score_candidate(
            RotationCandidate("AAPL", change_5m=0.4, change_15m=0.6, rsi=55, price=100, ema_20=98, volume_ratio=1.2),
            benchmark_change_5m=0.1,
            benchmark_change_15m=0.2,
            min_volume_ratio=0.5,
            max_rsi=70,
        )
        self.assertGreater(calm, hot)

    def test_relative_strength_uses_benchmark(self) -> None:
        leading = score_candidate(
            RotationCandidate("AMD", change_5m=0.3, price=100, ema_20=90),
            benchmark_change_5m=-0.2,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
        )
        lagging = score_candidate(
            RotationCandidate("INTC", change_5m=-0.1, price=100, ema_20=90),
            benchmark_change_5m=-0.2,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
        )
        self.assertGreater(leading, lagging)

    def test_red_session_excluded_from_rotation_scoring(self) -> None:
        weak = score_candidate(
            RotationCandidate("HON", change_5m=0.5, session_change_pct=-0.4),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            min_session_change_pct=0.0,
        )
        strong = score_candidate(
            RotationCandidate(
                "NVDA", change_5m=0.5, session_change_pct=0.2, price=100, ema_20=90
            ),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            min_session_change_pct=0.0,
        )
        self.assertEqual(weak, SESSION_DISQUALIFIED_SCORE)
        self.assertGreater(strong, 0)

    def test_unknown_session_fails_when_threshold_enabled(self) -> None:
        unknown = score_candidate(
            RotationCandidate("AAA", change_5m=1.0, session_change_pct=None),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            min_session_change_pct=0.0,
        )
        self.assertEqual(unknown, SESSION_DISQUALIFIED_SCORE)

    def test_below_ema20_disqualified_for_rotation(self) -> None:
        below = score_candidate(
            RotationCandidate("AAA", change_5m=2.0, price=97.0, ema_20=98.0),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            entry_ema_gate="ema_20",
        )
        above = score_candidate(
            RotationCandidate("BBB", change_5m=1.0, price=100.0, ema_20=98.0),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            entry_ema_gate="ema_20",
        )
        self.assertEqual(below, SESSION_DISQUALIFIED_SCORE)
        self.assertGreater(above, 0)

    def test_ema_warming_up_disqualified_when_gate_on(self) -> None:
        score = score_candidate(
            RotationCandidate("AAA", change_5m=2.0, price=100.0, ema_20=None),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            entry_ema_gate="ema_20",
        )
        self.assertEqual(score, SESSION_DISQUALIFIED_SCORE)

    def test_ema_gate_off_allows_below_ema(self) -> None:
        score = score_candidate(
            RotationCandidate("AAA", change_5m=2.0, price=97.0, ema_20=98.0),
            benchmark_change_5m=0.0,
            benchmark_change_15m=None,
            min_volume_ratio=0,
            max_rsi=70,
            entry_ema_gate="off",
        )
        self.assertGreater(score, 0)


class RotateActiveTests(unittest.TestCase):
    def test_seed_takes_the_top_names(self) -> None:
        result = rotate_active(
            ["AAA", "BBB", "CCC"],
            [],
            {"AAA": 1, "BBB": 3, "CCC": 2},
            active_size=2,
            max_swaps=2,
        )
        self.assertEqual(result.active, ["BBB", "CCC"])
        self.assertIn("seeded", result.note)

    def test_swap_is_capped_and_needs_a_clear_lead(self) -> None:
        result = rotate_active(
            ["AAA", "BBB", "CCC", "DDD"],
            ["AAA", "BBB"],
            {"AAA": 1.0, "BBB": 1.05, "CCC": 1.06, "DDD": 5.0},
            active_size=2,
            max_swaps=1,
        )
        self.assertEqual(result.swapped_in, ["DDD"])
        self.assertEqual(len(result.swapped_out), 1)
        self.assertEqual(len(result.active), 2)
        self.assertIn("DDD", result.active)

    def test_disqualified_incumbent_stays_without_eligible_challenger(self) -> None:
        scores = {
            "AAA": SESSION_DISQUALIFIED_SCORE,
            "BBB": 1.0,
        }
        result = rotate_active(
            ["AAA", "BBB"],
            ["AAA", "BBB"],
            scores,
            active_size=2,
            max_swaps=2,
        )
        self.assertEqual(result.active, ["AAA", "BBB"])
        self.assertEqual(result.note, "no change")

    def test_disqualified_incumbent_swapped_for_eligible_challenger(self) -> None:
        scores = {
            "AAA": SESSION_DISQUALIFIED_SCORE,
            "BBB": 2.0,
            "CCC": 3.0,
        }
        result = rotate_active(
            ["AAA", "BBB", "CCC"],
            ["AAA", "BBB"],
            scores,
            active_size=2,
            max_swaps=1,
        )
        self.assertNotIn("AAA", result.active)
        self.assertIn("BBB", result.active)
        self.assertIn("CCC", result.active)
        self.assertIn("CCC", result.swapped_in)

    def test_open_position_is_never_dropped(self) -> None:
        result = rotate_active(
            ["AAA", "BBB", "CCC"],
            ["AAA", "BBB"],
            {"AAA": 0.1, "BBB": 3, "CCC": 4},
            active_size=2,
            max_swaps=2,
            protected=["AAA"],
        )
        self.assertIn("AAA", result.active)
        self.assertNotIn("AAA", result.swapped_out)

    def test_backfill_puts_active_and_benchmark_first(self) -> None:
        ordered = backfill_order(["NVDA", "AAPL"], ["AMD", "NVDA", "COST"], "QQQ", ["AAPL"])
        self.assertEqual(ordered[:3], ["NVDA", "AAPL", "QQQ"])
        self.assertIn("COST", ordered)

    def test_slow_scan_does_not_grow_the_list(self) -> None:
        self.assertEqual(capped_active_size(12, 9, 40), 9)
        self.assertEqual(capped_active_size(12, 9, 16), 12)

    def test_seed_skips_disqualified_symbols(self) -> None:
        result = rotate_active(
            ["AAA", "BBB", "CCC"],
            [],
            {
                "AAA": SESSION_DISQUALIFIED_SCORE,
                "BBB": 3,
                "CCC": 2,
            },
            active_size=2,
            max_swaps=2,
        )
        self.assertEqual(result.active, ["BBB", "CCC"])


if __name__ == "__main__":
    unittest.main()
