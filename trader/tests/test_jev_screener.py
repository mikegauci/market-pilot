from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBarStore
from market.bars import Bar, BAR_SIZE_DAILY, BAR_SIZE_INTRADAY, BarStore, compute_trend_changes
from models.types import JevPrediction, JevRankedSymbol, RiskSettings
from watchlist.jev_screener import (
    _filter_stale_core_from_saved,
    merge_core_watchlist,
    merge_dynamic_watchlist,
    rank_predictions,
    resolve_trading_watchlist,
    screener_due,
    top_dynamic_symbols,
)


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


def _base_settings(**overrides) -> RiskSettings:
    defaults = dict(
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
        watchlist_core=["NVDA", "AAPL", "EEM"],
        watchlist_dynamic_enabled=True,
        benchmark_symbol="EEM",
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)


class TestJevScreener(unittest.TestCase):
    def test_rank_predictions_orders_by_buy_then_margin(self) -> None:
        predictions = {
            "AAA": JevPrediction("AAA", 0.7, 0.2, 0.1, datetime.now(timezone.utc)),
            "BBB": JevPrediction("BBB", 0.8, 0.15, 0.05, datetime.now(timezone.utc)),
            "CCC": JevPrediction("CCC", 0.8, 0.05, 0.15, datetime.now(timezone.utc)),
        }
        ranked = rank_predictions(predictions)
        self.assertEqual([item.symbol for item in ranked[:3]], ["CCC", "BBB", "AAA"])

    def test_top_dynamic_symbols_skips_benchmark(self) -> None:
        rankings = [
            JevRankedSymbol("EEM", 0.9, 0.05, 0.05, 1),
            JevRankedSymbol("BABA", 0.85, 0.1, 0.05, 2),
            JevRankedSymbol("VALE", 0.8, 0.15, 0.05, 3),
        ]
        self.assertEqual(top_dynamic_symbols(rankings, "EEM", 2), ["BABA", "VALE"])

    def test_merge_dynamic_watchlist_excludes_core(self) -> None:
        settings = _base_settings()
        merged = merge_dynamic_watchlist(
            settings,
            dynamic_symbols=["BABA", "VALE"],
            open_symbols=["NU"],
        )
        self.assertEqual(merged, ["BABA", "VALE", "NU"])
        self.assertNotIn("NVDA", merged)
        self.assertNotIn("AAPL", merged)
        self.assertNotIn("EEM", merged)

    def test_merge_core_watchlist_includes_core_and_open(self) -> None:
        settings = _base_settings()
        merged = merge_core_watchlist(settings, open_symbols=["NU"])
        self.assertEqual(merged, ["NVDA", "AAPL", "NU"])
        self.assertNotIn("EEM", merged)

    def test_filter_stale_core_from_saved(self) -> None:
        settings = _base_settings(
            watchlist_jev_rankings=[
                JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
                JevRankedSymbol("VALE", 0.85, 0.1, 0.05, 2),
            ],
        )
        filtered = _filter_stale_core_from_saved(
            settings,
            ["NVDA", "AAPL", "BABA", "VALE", "EEM"],
        )
        self.assertEqual(filtered, ["BABA", "VALE"])

    def test_resolve_trading_watchlist_dynamic_off_uses_core(self) -> None:
        settings = _base_settings(
            watchlist_dynamic_enabled=False,
            watchlist=["BABA", "VALE"],
        )
        self.assertEqual(resolve_trading_watchlist(settings), ["NVDA", "AAPL"])

    def test_resolve_trading_watchlist_dynamic_on_before_scan_uses_core(self) -> None:
        settings = _base_settings(
            watchlist=["BABA", "VALE"],
            watchlist_screener_ran_at=None,
        )
        self.assertEqual(resolve_trading_watchlist(settings), ["NVDA", "AAPL"])

    def test_resolve_trading_watchlist_strips_stale_union(self) -> None:
        settings = _base_settings(
            watchlist=["NVDA", "AAPL", "BABA", "VALE", "EEM"],
            watchlist_screener_ran_at=datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc),
            watchlist_jev_rankings=[
                JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
                JevRankedSymbol("VALE", 0.85, 0.1, 0.05, 2),
            ],
        )
        self.assertEqual(
            resolve_trading_watchlist(settings),
            ["BABA", "VALE"],
        )

    def test_resolve_trading_watchlist_merges_open_positions(self) -> None:
        settings = _base_settings(
            watchlist=["BABA", "VALE", "EEM"],
            watchlist_screener_ran_at=datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(
            resolve_trading_watchlist(settings, ["NU"]),
            ["BABA", "VALE", "NU"],
        )

    def test_resolve_trading_watchlist_never_includes_benchmark(self) -> None:
        settings = _base_settings(
            watchlist=["EEM", "BABA"],
            watchlist_screener_ran_at=datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc),
            watchlist_jev_rankings=[
                JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
                JevRankedSymbol("EEM", 0.95, 0.03, 0.02, 2),
            ],
        )
        self.assertEqual(resolve_trading_watchlist(settings, ["EEM"]), ["BABA"])

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
