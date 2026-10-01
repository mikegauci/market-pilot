from __future__ import annotations

import unittest

from models.types import JevRankedSymbol, RiskSettings, WatchlistPin
from watchlist.curation import (
    merge_curated_base_watchlist,
    prune_watchlist_pins_below_min_buy,
    qualifying_locked_pin_symbols,
)
from watchlist.jev_screener import resolve_base_watchlist, top_dynamic_symbols


def _settings(**overrides) -> RiskSettings:
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
        watchlist=["BABA", "VALE"],
        watchlist_core=["NVDA", "AAPL", "EEM"],
        watchlist_dynamic_enabled=True,
        watchlist_screener_ran_at=__import__("datetime").datetime(
            2026, 1, 10, 15, 0, tzinfo=__import__("datetime").timezone.utc
        ),
        watchlist_jev_rankings=[
            JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
            JevRankedSymbol("VALE", 0.85, 0.1, 0.05, 2),
            JevRankedSymbol("TSM", 0.7, 0.2, 0.1, 3),
        ],
        benchmark_symbol="EEM",
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)


class TestWatchlistCuration(unittest.TestCase):
    def test_top_dynamic_skips_dismissed(self) -> None:
        rankings = [
            JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
            JevRankedSymbol("VALE", 0.85, 0.1, 0.05, 2),
            JevRankedSymbol("INFY", 0.8, 0.1, 0.1, 3),
        ]
        picked = top_dynamic_symbols(
            rankings, "EEM", 2, min_buy=0.6, excluded={"BABA"}
        )
        self.assertEqual(picked, ["VALE", "INFY"])

    def test_locked_pin_extra_slot(self) -> None:
        settings = _settings(
            watchlist_pins=[
                WatchlistPin("TSM", locked=True, protect_demotion=True),
            ],
        )
        base = resolve_base_watchlist(settings)
        self.assertEqual(base, ["BABA", "VALE", "TSM"])

    def test_dismissed_removes_dynamic_symbol(self) -> None:
        settings = _settings(watchlist_dismissed=["VALE"])
        base = resolve_base_watchlist(settings)
        self.assertEqual(base, ["BABA"])

    def test_prune_locked_pin_below_min_buy(self) -> None:
        settings = _settings(
            watchlist_pins=[WatchlistPin("TSM", locked=True, protect_demotion=False)],
            watchlist_jev_rankings=[
                JevRankedSymbol("TSM", 0.4, 0.5, 0.1, 1),
            ],
            watchlist_min_buy=0.6,
        )
        pruned = prune_watchlist_pins_below_min_buy(
            settings, settings.watchlist_jev_rankings
        )
        self.assertEqual(pruned, [])

    def test_prune_locked_pin_not_scored_on_scan(self) -> None:
        settings = _settings(
            watchlist_pins=[WatchlistPin("INFY", locked=True, protect_demotion=False)],
            watchlist_jev_rankings=[
                JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
            ],
        )
        pruned = prune_watchlist_pins_below_min_buy(
            settings, settings.watchlist_jev_rankings
        )
        self.assertEqual(pruned, [])

    def test_locked_pin_without_score_still_merges(self) -> None:
        settings = _settings(
            watchlist=["BABA"],
            watchlist_pins=[WatchlistPin("INFY", locked=True, protect_demotion=False)],
            watchlist_jev_rankings=[
                JevRankedSymbol("BABA", 0.9, 0.05, 0.05, 1),
            ],
        )
        base = resolve_base_watchlist(settings)
        self.assertEqual(base, ["BABA", "INFY"])

    def test_dynamic_scan_rotates_without_explicit_pins(self) -> None:
        settings = _settings(
            watchlist=["NEW1", "NEW2"],
            watchlist_pins=[],
            watchlist_jev_rankings=[
                JevRankedSymbol("NEW1", 0.9, 0.05, 0.05, 1),
                JevRankedSymbol("NEW2", 0.85, 0.1, 0.05, 2),
            ],
        )
        base = resolve_base_watchlist(settings)
        self.assertEqual(base, ["NEW1", "NEW2"])
        self.assertNotIn("BABA", base)

    def test_qualifying_locked_requires_min_buy(self) -> None:
        settings = _settings(
            watchlist_pins=[WatchlistPin("TSM", locked=True, protect_demotion=False)],
        )
        locked = qualifying_locked_pin_symbols(settings, settings.watchlist_jev_rankings)
        self.assertEqual(locked, ["TSM"])

    def test_merge_curated_applies_dismissed(self) -> None:
        settings = _settings(watchlist_dismissed=["BABA"])
        merged = merge_curated_base_watchlist(
            settings, ["BABA", "VALE"], settings.watchlist_jev_rankings
        )
        self.assertEqual(merged, ["VALE"])


if __name__ == "__main__":
    unittest.main()
