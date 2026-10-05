from __future__ import annotations

import unittest
from datetime import datetime, timezone

from models.types import Quote, RiskSettings, TradeRecord
from strategy.exits import jev_sell_exit_allowed


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
        watchlist=["META"],
        min_hold_minutes=0.0,
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)  # type: ignore[arg-type]


def _trade(**overrides: object) -> TradeRecord:
    base = dict(
        id="test-trade",
        symbol="META",
        side="buy",
        entry_time=datetime(2026, 9, 28, 15, 40, tzinfo=timezone.utc),
        entry_price=100.0,
        quantity=10.0,
        position_value=1000.0,
        stop_loss=99.0,
        take_profit=102.0,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class TestJevSellExitAllowed(unittest.TestCase):
    def test_blocks_underwater_soft_exit(self) -> None:
        trade = _trade()
        quote = Quote(symbol="META", price=99.0, bid=None, ask=None, spread=None)
        self.assertFalse(jev_sell_exit_allowed(trade, _settings(), quote))

    def test_allows_breakeven_or_profit(self) -> None:
        trade = _trade()
        quote = Quote(symbol="META", price=100.0, bid=None, ask=None, spread=None)
        self.assertTrue(jev_sell_exit_allowed(trade, _settings(), quote))


if __name__ == "__main__":
    unittest.main()
