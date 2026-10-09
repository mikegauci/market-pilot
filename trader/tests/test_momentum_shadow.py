from __future__ import annotations

import unittest

from models.types import MarketState
from strategy.config import StrategyConfig
from strategy.momentum_shadow import (
    WOULD_BLOCK,
    WOULD_KEEP,
    momentum_shadow_verdict,
    with_momentum_shadow,
)


def _state(**overrides: object) -> MarketState:
    base = dict(
        symbol="PLTR",
        price=203.0,
        change_5m=0.34,
        change_15m=0.4,
        volume_ratio=4.2,
        rsi=60.0,
        ema_9=202.9,
        ema_20=202.7,
        bid=202.98,
        ask=203.02,
        spread=0.04,
        spy_change_5m=0.0,
    )
    base.update(overrides)
    return MarketState(**base)  # type: ignore[arg-type]


class MomentumShadowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = StrategyConfig()

    def test_strong_move_with_volume_is_kept(self) -> None:
        verdict, note = momentum_shadow_verdict(_state(), self.config)  # type: ignore[misc]
        self.assertEqual(verdict, WOULD_KEEP)
        self.assertIn("Strong move", note)

    def test_slow_drift_is_blocked(self) -> None:
        verdict, note = momentum_shadow_verdict(  # type: ignore[misc]
            _state(change_5m=0.06, volume_ratio=1.2), self.config
        )
        self.assertEqual(verdict, WOULD_BLOCK)
        self.assertIn("Too slow", note)

    def test_fresh_trend_without_volume_is_kept(self) -> None:
        verdict, note = momentum_shadow_verdict(  # type: ignore[misc]
            _state(volume_ratio=0.9, ema_9=202.69, ema_20=202.7), self.config
        )
        self.assertEqual(verdict, WOULD_KEEP)
        self.assertIn("Early trend", note)

    def test_move_without_volume_or_fresh_trend_is_blocked(self) -> None:
        # Today's 10:37 PLTR entry: 0.28% in 5m, 1.4x volume, EMA9 0.18% above EMA20.
        verdict, note = momentum_shadow_verdict(  # type: ignore[misc]
            _state(change_5m=0.28, volume_ratio=1.43, ema_9=203.06, ema_20=202.7),
            self.config,
        )
        self.assertEqual(verdict, WOULD_BLOCK)
        self.assertIn("No extra support", note)

    def test_missing_change_returns_none(self) -> None:
        self.assertIsNone(momentum_shadow_verdict(_state(change_5m=None), self.config))

    def test_zero_threshold_turns_check_off(self) -> None:
        config = StrategyConfig(shadow_momentum_min_change_5m_pct=0.0)
        state = _state()
        self.assertIs(with_momentum_shadow(state, config), state)

    def test_with_momentum_shadow_sets_snapshot_fields(self) -> None:
        snapshot = with_momentum_shadow(_state(), self.config).to_dict()
        self.assertEqual(snapshot["momentum_shadow_verdict"], WOULD_KEEP)
        self.assertTrue(snapshot["momentum_shadow_note"])


if __name__ == "__main__":
    unittest.main()
