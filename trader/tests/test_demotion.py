from __future__ import annotations

import unittest
from datetime import datetime, timezone

from models.types import JevRankedSymbol, Quote, RiskSettings, TradeRecord, WatchlistPin
from watchlist.demotion import (
    demoted_jev_sell_loss_allowed,
    effective_max_hold_minutes,
    is_demoted_symbol,
    is_off_effective_watchlist,
    jev_sell_exit_allowed,
)


def _settings(**overrides) -> RiskSettings:
    defaults = dict(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=1.0,
        max_position_size=100.0,
        max_daily_loss=10.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.02,
        max_hold_minutes=100.0,
        account_capital=1000.0,
        risk_sync_equity=None,
        watchlist=["BABA", "VALE", "EEM"],
        watchlist_core=["NVDA", "AAPL", "EEM"],
        watchlist_dynamic_enabled=True,
        watchlist_screener_ran_at=datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc),
        demotion_exits_enabled=True,
        demotion_max_hold_ratio=0.5,
        demotion_jev_sell_on_loss=True,
        demotion_jev_sell_max_loss_pct=0.02,
        demotion_force_exit=False,
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)


class TestDemotion(unittest.TestCase):
    def test_off_watchlist_when_not_in_effective_base(self) -> None:
        settings = _settings()
        self.assertTrue(is_off_effective_watchlist("NU", settings))
        self.assertFalse(is_off_effective_watchlist("BABA", settings))
        self.assertFalse(is_off_effective_watchlist("EEM", settings))

    def test_not_demoted_when_dynamic_off(self) -> None:
        settings = _settings(watchlist_dynamic_enabled=False)
        self.assertFalse(is_demoted_symbol("NU", settings))

    def test_protect_demotion_skips_demotion_exits(self) -> None:
        settings = _settings(
            watchlist=["VALE"],
            watchlist_jev_rankings=[
                JevRankedSymbol("VALE", 0.85, 0.1, 0.05, 1),
            ],
            watchlist_pins=[
                WatchlistPin("NU", locked=False, protect_demotion=True),
            ],
            watchlist_dismissed=["NU"],
        )
        self.assertTrue(is_off_effective_watchlist("NU", settings))
        self.assertFalse(is_demoted_symbol("NU", settings))

    def test_not_demoted_when_dynamic_list_empty(self) -> None:
        settings = _settings(watchlist=[])
        self.assertFalse(is_off_effective_watchlist("NU", settings))
        self.assertFalse(is_demoted_symbol("NU", settings))

    def test_effective_max_hold_halved_for_demoted(self) -> None:
        settings = _settings()
        self.assertEqual(effective_max_hold_minutes("NU", settings), 50.0)
        self.assertEqual(effective_max_hold_minutes("BABA", settings), 100.0)

    def test_effective_max_hold_zero_ratio_exits_immediately(self) -> None:
        settings = _settings(demotion_max_hold_ratio=0.0)
        self.assertAlmostEqual(effective_max_hold_minutes("NU", settings), 0.001)

    def test_demoted_jev_sell_within_loss_cap(self) -> None:
        settings = _settings()
        trade = TradeRecord(
            id="t1",
            symbol="NU",
            side="buy",
            entry_time=datetime.now(timezone.utc),
            entry_price=100.0,
            quantity=1.0,
            position_value=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            status="open",
            paper_or_live="paper",
        )
        quote = Quote(symbol="NU", price=99.0, bid=None, ask=None, spread=None)
        self.assertTrue(demoted_jev_sell_loss_allowed(trade, settings, quote))

    def test_demoted_jev_sell_blocked_beyond_loss_cap(self) -> None:
        settings = _settings()
        trade = TradeRecord(
            id="t1",
            symbol="NU",
            side="buy",
            entry_time=datetime.now(timezone.utc),
            entry_price=100.0,
            quantity=1.0,
            position_value=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            status="open",
            paper_or_live="paper",
        )
        quote = Quote(symbol="NU", price=97.0, bid=None, ask=None, spread=None)
        self.assertFalse(demoted_jev_sell_loss_allowed(trade, settings, quote))

    def test_jev_sell_exit_allowed_for_demoted_loser(self) -> None:
        settings = _settings()
        settings.min_hold_minutes = 0.0
        trade = TradeRecord(
            id="t1",
            symbol="NU",
            side="buy",
            entry_time=datetime.now(timezone.utc),
            entry_price=100.0,
            quantity=1.0,
            position_value=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            status="open",
            paper_or_live="paper",
        )
        quote = Quote(symbol="NU", price=99.0, bid=None, ask=None, spread=None)
        self.assertTrue(jev_sell_exit_allowed(trade, settings, quote))


if __name__ == "__main__":
    unittest.main()
