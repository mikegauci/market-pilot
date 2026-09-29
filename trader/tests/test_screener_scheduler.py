from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from config import Settings
from models.types import DataSource, RiskSettings
from watchlist.screener_scheduler import EMWatchlistScheduler, ScreenerJobContext


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
