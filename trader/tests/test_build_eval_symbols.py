from __future__ import annotations

import unittest
from datetime import datetime, timezone

from main import build_eval_symbols
from models.types import RiskSettings


def _settings(**overrides: object) -> RiskSettings:
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
        watchlist=["BABA", "VALE"],
        watchlist_core=["NVDA", "AAPL"],
        watchlist_dynamic_enabled=True,
        watchlist_screener_ran_at=datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc),
        benchmark_symbol="EEM",
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)  # type: ignore[arg-type]


class TestBuildEvalSymbols(unittest.TestCase):
    def test_strips_benchmark_from_watchlist(self) -> None:
        symbols = build_eval_symbols(
            ["BABA", "EEM", "VALE"],
            [],
            _settings(),
        )
        self.assertEqual(symbols, ["BABA", "VALE"])

    def test_keeps_open_benchmark_for_exits(self) -> None:
        symbols = build_eval_symbols(
            ["BABA", "EEM"],
            ["EEM"],
            _settings(),
        )
        self.assertEqual(symbols, ["BABA", "EEM"])

    def test_without_risk_settings_keeps_all(self) -> None:
        symbols = build_eval_symbols(["BABA", "EEM"], ["VALE"], None)
        self.assertEqual(symbols, ["BABA", "EEM", "VALE"])


if __name__ == "__main__":
    unittest.main()
