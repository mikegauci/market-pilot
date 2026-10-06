from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from market.bar_aggregator import MinuteBarStore
from models.types import RiskSettings
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from watchlist.rotation_runtime import maybe_rotate_watchlist


class MaybeRotateWatchlistTests(unittest.TestCase):
    def test_rotation_disabled_is_noop(self) -> None:
        risk = RiskSettings(
            minimum_jev_confidence=0.85,
            signal_record_threshold=0.75,
            risk_per_trade=100.0,
            max_position_size=10_000.0,
            max_daily_loss=500.0,
            max_open_positions=5,
            stop_loss_percentage=0.01,
            take_profit_percentage=0.015,
            max_hold_minutes=0.0,
            account_capital=10_000.0,
            risk_sync_equity=None,
            watchlist=["AAA"],
            watchlist_rotation_enabled=False,
            watchlist_pool=["AAA", "BBB"],
            watchlist_active=["AAA"],
            watchlist_active_size=1,
        )
        runtime = TraderRuntimeState()
        runtime.last_rotation_mono = 0.0
        updated, swapped = maybe_rotate_watchlist(
            db=None,
            risk_settings=risk,
            minute_bars=MinuteBarStore(["AAA", "BBB"]),
            bar_store=None,
            quotes_by_symbol={},
            benchmark_minute_bars=None,
            confirmation_tracker=ConfirmationTracker(1),
            open_symbols=[],
            runtime=runtime,
            now_mono=10_000.0,
            market_open=True,
            strategy_config=StrategyConfig(),
        )
        self.assertIs(updated, risk)
        self.assertEqual(swapped, [])

    def test_saves_rotation_when_active_changes(self) -> None:
        risk = RiskSettings(
            minimum_jev_confidence=0.85,
            signal_record_threshold=0.75,
            risk_per_trade=100.0,
            max_position_size=10_000.0,
            max_daily_loss=500.0,
            max_open_positions=5,
            stop_loss_percentage=0.01,
            take_profit_percentage=0.015,
            max_hold_minutes=0.0,
            account_capital=10_000.0,
            risk_sync_equity=None,
            watchlist=["AAA"],
            watchlist_rotation_enabled=True,
            watchlist_pool=["AAA", "BBB", "CCC"],
            watchlist_active=[],
            watchlist_active_size=2,
            watchlist_rotation_interval_minutes=1,
            watchlist_max_swaps_per_rotation=2,
        )
        runtime = TraderRuntimeState()
        runtime.last_rotation_mono = 0.0
        db = MagicMock()
        minute_bars = MinuteBarStore(["AAA", "BBB", "CCC"])
        updated, swapped = maybe_rotate_watchlist(
            db=db,
            risk_settings=risk,
            minute_bars=minute_bars,
            bar_store=None,
            quotes_by_symbol={},
            benchmark_minute_bars=None,
            confirmation_tracker=ConfirmationTracker(1),
            open_symbols=[],
            runtime=runtime,
            now_mono=100.0,
            market_open=True,
            strategy_config=StrategyConfig(min_volume_ratio=0.0, max_rsi=99),
        )
        self.assertNotEqual(updated.watchlist_active, [])
        db.save_watchlist_rotation.assert_called_once()
        self.assertIsInstance(swapped, list)


if __name__ == "__main__":
    unittest.main()
