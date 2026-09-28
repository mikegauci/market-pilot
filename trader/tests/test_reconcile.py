from __future__ import annotations

import unittest

from broker.reconcile import build_reconciled_trade, orphan_ibkr_symbols
from models.types import BracketLegs, Position, RiskSettings, TradeRecord, TradingMode


def _risk_settings() -> RiskSettings:
    return RiskSettings(
        minimum_jev_confidence=0.7,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=5000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        account_capital=10000.0,
        risk_sync_equity=None,
        watchlist=["META", "AAPL"],
    )


class TestOrphanIbkrSymbols(unittest.TestCase):
    def test_detects_untracked_position(self) -> None:
        positions = [
            Position(
                symbol="META",
                quantity=13.0,
                avg_cost=746.73,
                market_price=746.0,
                market_value=9698.0,
                unrealized_pnl=-9.45,
            )
        ]
        open_trades = [
            TradeRecord(
                id="1",
                symbol="AAPL",
                side="buy",
                entry_time=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
                entry_price=100.0,
                quantity=1.0,
                position_value=100.0,
                stop_loss=99.0,
                take_profit=101.0,
                status="open",
                paper_or_live="paper",
                execution_mode="ibkr",
            )
        ]

        orphans = orphan_ibkr_symbols(positions, open_trades, watchlist={"META", "AAPL"})
        self.assertEqual(len(orphans), 1)
        self.assertEqual(orphans[0].symbol, "META")

    def test_ignores_symbols_outside_watchlist(self) -> None:
        positions = [
            Position(
                symbol="TSLA",
                quantity=5.0,
                avg_cost=300.0,
                market_price=301.0,
                market_value=1505.0,
                unrealized_pnl=5.0,
            )
        ]
        orphans = orphan_ibkr_symbols(positions, [], watchlist={"META"})
        self.assertEqual(orphans, [])


class TestBuildReconciledTrade(unittest.TestCase):
    def test_uses_bracket_legs_when_present(self) -> None:
        position = Position(
            symbol="META",
            quantity=13.0,
            avg_cost=746.73,
            market_price=746.0,
            market_value=9698.0,
            unrealized_pnl=-9.45,
        )
        legs = BracketLegs(
            parent_order_id=23,
            sl_order_id=25,
            tp_order_id=24,
            stop_loss=738.54,
            take_profit=757.19,
        )

        trade = build_reconciled_trade(
            position,
            _risk_settings(),
            TradingMode.PAPER,
            legs,
        )

        self.assertEqual(trade.symbol, "META")
        self.assertEqual(trade.quantity, 13.0)
        self.assertEqual(trade.entry_price, 746.73)
        self.assertEqual(trade.stop_loss, 738.54)
        self.assertEqual(trade.take_profit, 757.19)
        self.assertEqual(trade.ibkr_sl_order_id, 25)
        self.assertEqual(trade.ibkr_tp_order_id, 24)
        self.assertEqual(trade.execution_mode, "ibkr")

    def test_computes_bracket_prices_without_legs(self) -> None:
        position = Position(
            symbol="META",
            quantity=13.0,
            avg_cost=100.0,
            market_price=100.0,
            market_value=1300.0,
            unrealized_pnl=0.0,
        )

        trade = build_reconciled_trade(
            position,
            _risk_settings(),
            TradingMode.PAPER,
            None,
        )

        self.assertEqual(trade.stop_loss, 99.0)
        self.assertEqual(trade.take_profit, 101.5)
        self.assertIsNone(trade.ibkr_sl_order_id)


if __name__ == "__main__":
    unittest.main()
