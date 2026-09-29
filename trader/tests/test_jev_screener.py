from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBarStore
from market.bars import Bar, BAR_SIZE_DAILY, BAR_SIZE_INTRADAY, BarStore, compute_trend_changes
from models.types import JevPrediction, JevRankedSymbol, RiskSettings
from watchlist.jev_screener import merge_effective_watchlist, rank_predictions, screener_due


class InMemoryBarRepo:
    def __init__(self) -> None:
        self.bars: list[Bar] = []
        self.meta: dict[tuple[str, str], datetime] = {}

    def get_bars(self, symbol: str, bar_size: str) -> list[Bar]:
        return [
            bar
            for bar in self.bars
            if bar.symbol == symbol.upper() and bar.bar_size == bar_size
        ]

    def upsert_bars(self, bars) -> None:
        self.bars.extend(bars)

    def get_last_fetched_at(self, symbol: str, bar_size: str):
        return self.meta.get((symbol.upper(), bar_size))

    def set_last_fetched_at(self, symbol: str, bar_size: str, fetched_at: datetime) -> None:
        self.meta[(symbol.upper(), bar_size)] = fetched_at


class TestJevScreener(unittest.TestCase):
    def test_rank_predictions_orders_by_buy_then_margin(self) -> None:
        predictions = {
            "AAA": JevPrediction("AAA", 0.7, 0.2, 0.1, datetime.now(timezone.utc)),
            "BBB": JevPrediction("BBB", 0.8, 0.15, 0.05, datetime.now(timezone.utc)),
            "CCC": JevPrediction("CCC", 0.8, 0.05, 0.15, datetime.now(timezone.utc)),
        }
        ranked = rank_predictions(predictions)
        self.assertEqual([item.symbol for item in ranked[:3]], ["CCC", "BBB", "AAA"])

    def test_merge_effective_watchlist_dedupes(self) -> None:
        settings = RiskSettings(
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
            watchlist=["OLD"],
            watchlist_core=["EEM", "VALE"],
            watchlist_dynamic_enabled=True,
            benchmark_symbol="EEM",
        )
        merged = merge_effective_watchlist(
            settings,
            dynamic_symbols=["BABA", "VALE"],
            open_symbols=["NU"],
        )
        self.assertEqual(merged, ["EEM", "VALE", "BABA", "NU"])

    def test_screener_due_respects_refresh_interval(self) -> None:
        now = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
        settings = RiskSettings(
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
            watchlist=["EEM"],
            watchlist_dynamic_enabled=True,
            watchlist_refresh_minutes=30,
            watchlist_screener_ran_at=now - timedelta(minutes=10),
        )
        self.assertFalse(screener_due(settings, now=now))
        settings.watchlist_screener_ran_at = now - timedelta(minutes=31)
        self.assertTrue(screener_due(settings, now=now))

    def test_seed_minute_aggregator_from_intraday_bars(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo)
        minute_bars = MinuteBarStore(["VALE"])
        now = datetime.now(timezone.utc)
        repo.bars = [
            Bar("VALE", BAR_SIZE_INTRADAY, now - timedelta(minutes=10), 10, 10, 10, 10.0, 1000),
            Bar("VALE", BAR_SIZE_INTRADAY, now - timedelta(minutes=5), 10, 10, 10, 10.5, 1000),
            Bar("VALE", BAR_SIZE_INTRADAY, now - timedelta(minutes=1), 10.5, 10.6, 10.4, 10.55, 1200),
        ]
        store.seed_minute_aggregator(minute_bars.get("VALE"), "VALE")
        self.assertGreaterEqual(minute_bars.get("VALE").bar_count(), 15)

    def test_compute_trend_changes(self) -> None:
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        bars = [
            Bar("VALE", BAR_SIZE_DAILY, base, 10, 10, 10, 10, 1),
            Bar("VALE", BAR_SIZE_DAILY, base + timedelta(days=1), 10, 10, 10, 11, 1),
        ]
        trends = compute_trend_changes(bars)
        self.assertEqual(trends.change_1d, 10.0)


if __name__ == "__main__":
    unittest.main()
