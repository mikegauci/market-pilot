from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from config import Settings
from market.bars import BackfillSymbolResult, BarStore
from models.types import DataSource, RiskSettings
from runtime.state import TraderRuntimeState
from tests.test_bars_refresh import InMemoryBarRepo
from watchlist.backfill import drain_deferred_backfill_queue, run_phased_startup_backfill
from watchlist.backfill_plan import startup_backfill_universe


def _risk(**overrides) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.74,
        signal_record_threshold=0.65,
        risk_per_trade=100.0,
        max_position_size=5_000.0,
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
        watchlist_active=["AAA", "BBB"],
        watchlist_active_size=2,
        benchmark_symbol="QQQ",
    )
    base.update(overrides)
    return RiskSettings(**base)


class PhasedBackfillTests(unittest.TestCase):
    def test_startup_universe_splits_critical_and_deferred(self) -> None:
        critical, full, deferred = startup_backfill_universe(_risk(), ["AAA"])
        self.assertIn("AAA", critical)
        self.assertIn("BBB", critical)
        self.assertIn("QQQ", critical)
        self.assertEqual(deferred, ["CCC"])
        self.assertIn("CCC", full)

    def test_phased_startup_queues_deferred_and_backfills_critical_only(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        runtime = TraderRuntimeState()
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        settings = Settings(data_source=DataSource.IBKR)

        with patch.object(store, "backfill_universe") as backfill_universe:
            backfill_universe.return_value.refreshed = 1
            run_phased_startup_backfill(
                settings,
                store,
                ibkr,
                _risk(),
                ["AAA"],
                runtime,
            )

        backfill_universe.assert_called_once()
        called_symbols = backfill_universe.call_args[0][0]
        self.assertEqual(set(called_symbols), {"AAA", "BBB", "QQQ"})
        self.assertEqual(runtime.deferred_backfill_queue, ["CCC"])

    def test_drain_queue_processes_one_symbol_per_call(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        runtime = TraderRuntimeState(deferred_backfill_queue=["CCC", "AMD"])
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        settings = Settings(data_source=DataSource.IBKR)

        with patch.object(store, "backfill_symbol") as backfill_symbol:
            backfill_symbol.return_value = BackfillSymbolResult("CCC", "refreshed")
            drain_deferred_backfill_queue(settings, store, ibkr, runtime)

        backfill_symbol.assert_called_once_with("CCC", ibkr)
        self.assertEqual(runtime.deferred_backfill_queue, ["AMD"])

    def test_drain_skips_fresh_symbol_without_ibkr_call(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo, backfill_pacing_sec=0)
        runtime = TraderRuntimeState(deferred_backfill_queue=["CCC"])
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        settings = Settings(data_source=DataSource.IBKR)

        with patch.object(store, "needs_backfill", return_value=False):
            with patch.object(store, "backfill_symbol") as backfill_symbol:
                drain_deferred_backfill_queue(settings, store, ibkr, runtime)

        backfill_symbol.assert_not_called()
        self.assertEqual(runtime.deferred_backfill_queue, [])

    def test_phased_startup_disconnected_is_noop(self) -> None:
        runtime = TraderRuntimeState()
        ibkr = MagicMock()
        ibkr.is_connected.return_value = False
        settings = Settings(data_source=DataSource.IBKR)
        run_phased_startup_backfill(
            settings,
            BarStore(InMemoryBarRepo()),
            ibkr,
            _risk(),
            [],
            runtime,
        )
        self.assertEqual(runtime.deferred_backfill_queue, [])


if __name__ == "__main__":
    unittest.main()
