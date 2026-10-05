from __future__ import annotations

import unittest
from datetime import datetime, timezone

from main import build_eval_symbols, eval_allow_five_min_fallback
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

    def test_eval_allow_five_min_fallback_for_cached_intraday(self) -> None:
        bars = [object()] * 15
        self.assertTrue(eval_allow_five_min_fallback(False, bars, 15))
        self.assertFalse(eval_allow_five_min_fallback(False, bars[:14], 15))
        self.assertTrue(eval_allow_five_min_fallback(True, None, 15))


if __name__ == "__main__":
    unittest.main()
