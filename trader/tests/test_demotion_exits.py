from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from broker.execution import close_ibkr_signal_exits, collect_demotion_exit_symbols
from models.types import Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager


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
        demotion_force_exit=True,
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)


def _trade(**overrides) -> TradeRecord:
    base = dict(
        id="trade-1",
        symbol="NU",
        side="buy",
        entry_time=datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc),
        entry_price=100.0,
        quantity=1.0,
        position_value=100.0,
        stop_loss=95.0,
        take_profit=110.0,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class TestDemotionForceExit(unittest.TestCase):
    def test_simulated_force_exit_closes_demoted_trade(self) -> None:
        manager = RiskManager(
            settings=_settings(),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
            open_trades=[_trade()],
        )
        quotes = {"NU": Quote(symbol="NU", price=99.0, bid=None, ask=None, spread=None)}

        closed = manager.check_demotion_exits(quotes)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "demotion_exit")
        self.assertEqual(manager.open_trades, [])

    def test_force_exit_skipped_when_disabled(self) -> None:
        manager = RiskManager(
            settings=_settings(demotion_force_exit=False),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
            open_trades=[_trade()],
        )
        quotes = {"NU": Quote(symbol="NU", price=99.0, bid=None, ask=None, spread=None)}

        closed = manager.check_demotion_exits(quotes)

        self.assertEqual(closed, [])
        self.assertEqual(len(manager.open_trades), 1)

    def test_collect_demotion_exit_symbols_for_ibkr(self) -> None:
        settings = _settings()
        trades = [_trade(execution_mode="ibkr", ibkr_parent_order_id=1)]

        symbols = collect_demotion_exit_symbols(trades, settings)

        self.assertEqual(symbols, {"NU"})

    def test_ibkr_demotion_force_exit(self) -> None:
        manager = RiskManager(
            settings=_settings(),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
            open_trades=[
                _trade(
                    execution_mode="ibkr",
                    ibkr_parent_order_id=1,
                    ibkr_sl_order_id=2,
                    ibkr_tp_order_id=3,
                )
            ],
        )
        ibkr = MagicMock()
        from models.types import OrderFill

        ibkr.close_long_position.return_value = OrderFill(
            price=99.0, quantity=1.0, commission=0.0
        )
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0

        closed, _closed_ids = close_ibkr_signal_exits(
            ibkr,
            manager,
            db,
            demotion_exit_symbols={"NU"},
        )

        self.assertTrue(closed)
        ibkr.close_long_position.assert_called_once()
        db.close_trade.assert_called_once()
        self.assertEqual(db.close_trade.call_args.kwargs["exit_reason"], "demotion_exit")
        self.assertEqual(manager.open_trades, [])


if __name__ == "__main__":
    unittest.main()
