from __future__ import annotations

import unittest

from models.types import RiskSettings
from watchlist.resolution import (
    effective_benchmark,
    resolve_rotation_scan_watchlist,
    resolve_runtime_watchlist,
    resolve_trading_watchlist,
    strip_benchmark_symbol,
    strip_blocked_symbols,
)


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
        watchlist=["NVDA", "AAPL"],
        benchmark_symbol="",
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)  # type: ignore[arg-type]


class TestWatchlistResolution(unittest.TestCase):
    def test_effective_benchmark_uses_settings(self) -> None:
        self.assertEqual(effective_benchmark(_settings()), "")
        self.assertEqual(
            effective_benchmark(_settings(benchmark_symbol="SPY")),
            "SPY",
        )

    def test_strip_benchmark_symbol(self) -> None:
        settings = _settings(benchmark_symbol="EEM")
        self.assertEqual(
            strip_benchmark_symbol(["NVDA", "EEM", "AAPL"], settings),
            ["NVDA", "AAPL"],
        )

    def test_resolve_trading_watchlist_merges_open_positions(self) -> None:
        settings = _settings()
        self.assertEqual(
            resolve_trading_watchlist(settings, ["MSFT"]),
            ["NVDA", "AAPL", "MSFT"],
        )

    def test_resolve_runtime_watchlist_uses_env_fallback_when_empty(self) -> None:
        settings = _settings(watchlist=[])
        self.assertEqual(
            resolve_runtime_watchlist(settings, env_fallback=["BABA"]),
            ["BABA"],
        )

    def test_strip_blocked_symbols(self) -> None:
        settings = _settings(entry_blocked_symbols=["ISRG", "isrg"])
        self.assertEqual(
            strip_blocked_symbols(["NVDA", "ISRG", "AAPL"], settings),
            ["NVDA", "AAPL"],
        )

    def test_resolve_trading_watchlist_strips_blocked(self) -> None:
        settings = _settings(entry_blocked_symbols=["NVDA"])
        self.assertEqual(resolve_trading_watchlist(settings), ["AAPL"])

    def test_rotation_scan_watchlist_never_falls_back_to_pool(self) -> None:
        settings = _settings(
            watchlist_rotation_enabled=True,
            watchlist_pool=["AAA", "BBB", "CCC"],
            watchlist_active=[],
            entry_blocked_symbols=[],
        )
        self.assertEqual(resolve_rotation_scan_watchlist(settings), [])

    def test_rotation_scan_watchlist_strips_blocked(self) -> None:
        settings = _settings(
            watchlist_rotation_enabled=True,
            watchlist_pool=["AAA", "BBB"],
            watchlist_active=["ISRG", "NVDA"],
            entry_blocked_symbols=["ISRG"],
        )
        self.assertEqual(resolve_rotation_scan_watchlist(settings), ["NVDA"])


if __name__ == "__main__":
    unittest.main()
