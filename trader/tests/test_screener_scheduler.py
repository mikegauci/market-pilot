from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from config import Settings
from models.types import DataSource, RiskSettings
from watchlist.screener_scheduler import (
    EMWatchlistScheduler,
    ScreenerJobContext,
    backfill_watchlist_symbols,
)


def _job(*, had_scan: bool = False) -> ScreenerJobContext:
    risk_settings = RiskSettings(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=1.0,
        max_position_size=100.0,
        max_daily_loss=10.0,
        max_open_positions=2,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.02,
        max_hold_minutes=0.0,
        account_capital=1000.0,
        risk_sync_equity=None,
        watchlist=["BABA", "VALE", "EEM"],
        watchlist_core=["NVDA", "AAPL", "EEM"],
        watchlist_dynamic_enabled=True,
        benchmark_symbol="EEM",
        watchlist_screener_ran_at=(
            datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc) if had_scan else None
        ),
    )
    settings = Settings(data_source=DataSource.MOCK)
    return ScreenerJobContext(
        settings=settings,
        risk_settings=risk_settings,
        db=MagicMock(),
        jev=MagicMock(),
        minute_bars=MagicMock(),
        bar_store=MagicMock(),
        mock=MagicMock(),
        ibkr=MagicMock(),
        open_symbols=["NU"],
        strategy_config=MagicMock(),
        news_service=None,
        get_quotes=lambda symbols: [],
    )


class TestScreenerScheduler(unittest.TestCase):
    def test_backfill_watchlist_symbols_uses_main_ibkr(self) -> None:
        settings = Settings(data_source=DataSource.IBKR)
        bar_store = MagicMock()
        bar_store.symbols_needing_backfill.return_value = ["AMD", "NVDA"]
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True

        backfill_watchlist_symbols(settings, bar_store, ibkr, ["AMD", "NVDA", "AMD"])

        bar_store.symbols_needing_backfill.assert_called_once_with(["AMD", "NVDA"])
        bar_store.backfill_universe.assert_called_once_with(
            ["AMD", "NVDA"],
            ibkr,
            pacing_sec=settings.bar_backfill_pacing_sec,
        )

    def test_backfill_watchlist_symbols_skips_when_cache_fresh(self) -> None:
        settings = Settings(data_source=DataSource.IBKR)
        bar_store = MagicMock()
        bar_store.symbols_needing_backfill.return_value = []
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True

        backfill_watchlist_symbols(settings, bar_store, ibkr, ["AMD", "NVDA"])

        bar_store.backfill_universe.assert_not_called()

    def test_start_em_backfill_excludes_watchlist_symbols(self) -> None:
        scheduler = EMWatchlistScheduler()
        settings = Settings(data_source=DataSource.IBKR, em_backfill_on_startup=True)
        bar_store = MagicMock()
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True

        with patch(
            "watchlist.screener_scheduler._connect_backfill_ibkr",
            return_value=MagicMock(is_connected=MagicMock(return_value=True)),
        ) as connect_mock:
            scheduler.start_em_backfill(
                settings,
                bar_store,
                ibkr,
                ["ATAT", "AMD"],
                exclude_symbols=["AMD", "NVDA"],
            )
            scheduler._backfill_thread.join(timeout=2)

        connect_mock.assert_called_once_with(settings)
        bar_store.backfill_universe.assert_called_once()
        self.assertEqual(bar_store.backfill_universe.call_args.args[0], ["ATAT"])

    def test_start_em_backfill_skipped_when_disabled(self) -> None:
        scheduler = EMWatchlistScheduler()
        settings = Settings(data_source=DataSource.IBKR, em_backfill_on_startup=False)
        bar_store = MagicMock()
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True

        scheduler.start_em_backfill(settings, bar_store, ibkr, ["ATAT"])

        self.assertTrue(scheduler._backfill_done.is_set())
        bar_store.backfill_universe.assert_not_called()

    def test_cache_not_ready_does_not_persist_fallback(self) -> None:
        scheduler = EMWatchlistScheduler()
        job = _job(had_scan=False)
        with patch(
            "watchlist.screener_scheduler.load_em_universe",
            return_value=["BABA", "VALE"],
        ):
            with patch.object(scheduler, "_cache_ready", return_value=False):
                scheduler._run_screener(job)
        job.db.update_effective_watchlist_fallback.assert_not_called()
        self.assertIsNone(scheduler.take_completed_screener_result())

    def test_universe_unavailable_persists_fallback_when_never_scanned(self) -> None:
        scheduler = EMWatchlistScheduler()
        job = _job(had_scan=False)
        with patch(
            "watchlist.screener_scheduler.load_em_universe",
            side_effect=FileNotFoundError("missing"),
        ):
            scheduler._run_screener(job)
        job.db.update_effective_watchlist_fallback.assert_called_once()
        result = scheduler.take_completed_screener_result()
        self.assertIsNotNone(result)
        assert result is not None
        self.assertIsNone(result.screener_ran_at)
        self.assertIn("NVDA", result.watchlist)
        self.assertIn("NU", result.watchlist)

    def test_universe_unavailable_keeps_last_dynamic_list_after_success(self) -> None:
        scheduler = EMWatchlistScheduler()
        job = _job(had_scan=True)
        with patch(
            "watchlist.screener_scheduler.load_em_universe",
            side_effect=FileNotFoundError("missing"),
        ):
            scheduler._run_screener(job)
        job.db.update_effective_watchlist_fallback.assert_not_called()
        self.assertIsNone(scheduler.take_completed_screener_result())

    def test_low_score_persists_fallback_only_before_first_success(self) -> None:
        scheduler = EMWatchlistScheduler()
        job = _job(had_scan=False)
        with patch(
            "watchlist.screener_scheduler.load_em_universe",
            return_value=["BABA", "VALE"],
        ):
            with patch.object(scheduler, "_cache_ready", return_value=True):
                with patch(
                    "watchlist.screener_scheduler.run_jev_universe_scan",
                    return_value=(["BABA", "EEM"], []),
                ):
                    scheduler._run_screener(job)
        job.db.update_effective_watchlist_fallback.assert_called_once()

    def test_low_score_keeps_last_dynamic_list_after_success(self) -> None:
        scheduler = EMWatchlistScheduler()
        job = _job(had_scan=True)
        with patch(
            "watchlist.screener_scheduler.load_em_universe",
            return_value=["BABA", "VALE"],
        ):
            with patch.object(scheduler, "_cache_ready", return_value=True):
                with patch(
                    "watchlist.screener_scheduler.run_jev_universe_scan",
                    return_value=(["BABA", "EEM"], []),
                ):
                    scheduler._run_screener(job)
        job.db.update_effective_watchlist_fallback.assert_not_called()
        job.db.update_effective_watchlist.assert_not_called()


if __name__ == "__main__":
    unittest.main()
