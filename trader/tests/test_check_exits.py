from __future__ import annotations

import unittest
from datetime import datetime, timezone

from models.types import Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager


def _risk_settings() -> RiskSettings:
    return RiskSettings(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=10_000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10_000.0,
        risk_sync_equity=None,
        watchlist=["META", "NVDA"],
    )


def _trade(**overrides: object) -> TradeRecord:
    base = dict(
        id="test-trade",
        symbol="META",
        side="buy",
        entry_time=datetime(2026, 9, 28, 15, 40, tzinfo=timezone.utc),
        entry_price=746.73,
        quantity=13.0,
        position_value=746.73 * 13.0,
        stop_loss=739.26,
        take_profit=757.93,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class TestCheckExits(unittest.TestCase):
    def setUp(self) -> None:
        self.manager = RiskManager(
            settings=_risk_settings(),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )

    def test_simulated_trade_closes_on_stop_loss(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {"META": Quote(symbol="META", price=735.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_exits(quotes)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].exit_price, 739.26)
        self.assertEqual(closed[0].reason, "stop_loss")
        self.assertEqual(self.manager.open_trades, [])

    def test_ibkr_trade_with_brackets_skips_simulated_exit(self) -> None:
        self.manager.open_trades = [
            _trade(
                execution_mode="ibkr",
                ibkr_parent_order_id=1,
                ibkr_sl_order_id=2,
                ibkr_tp_order_id=3,
            )
        ]
        quotes = {"META": Quote(symbol="META", price=735.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_exits(quotes)

        self.assertEqual(closed, [])
        self.assertEqual(len(self.manager.open_trades), 1)

    def test_ibkr_orphan_without_brackets_skips_simulated_exit(self) -> None:
        self.manager.open_trades = [
            _trade(
                execution_mode="ibkr",
                ibkr_parent_order_id=None,
                ibkr_sl_order_id=None,
                ibkr_tp_order_id=None,
            )
        ]
        quotes = {"META": Quote(symbol="META", price=735.0, bid=None, ask=None, spread=None)}

        closed = self.manager.check_exits(quotes)

        self.assertEqual(closed, [])
        self.assertEqual(len(self.manager.open_trades), 1)


if __name__ == "__main__":
    unittest.main()
