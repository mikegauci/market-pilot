from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from broker.execution import close_ibkr_signal_exits, collect_loss_cut_trade_ids
from models.types import OrderFill, Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager
from strategy.exits import (
    loss_cut_should_exit,
    normalize_loss_cut_fractions,
    stop_loss_path_progress,
)
from strategy.profit_take_tracker import ProfitTakeBandTracker


def _risk_settings(**overrides: object) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=10_000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.10,
        max_hold_minutes=0.0,
        account_capital=10_000.0,
        risk_sync_equity=None,
        watchlist=["META"],
        min_hold_minutes=0.0,
        loss_cut_enabled=True,
        loss_cut_min_fraction=0.70,
        loss_cut_max_fraction=0.90,
        loss_cut_min_band_hits=3,
        loss_cut_band_window_cycles=10,
        loss_cut_jev_sell_threshold=0.0,
    )
    base.update(overrides)
    return RiskSettings(**base)  # type: ignore[arg-type]


def _trade(**overrides: object) -> TradeRecord:
    base = dict(
        id="test-trade",
        symbol="META",
        side="buy",
        entry_time=datetime(2026, 9, 28, 15, 40, tzinfo=timezone.utc),
        entry_price=100.0,
        quantity=10.0,
        position_value=1000.0,
        stop_loss=95.0,
        take_profit=110.0,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


def _record_band_hits(
    tracker: ProfitTakeBandTracker,
    trade_id: str,
    hits: int,
    *,
    in_band: bool = True,
) -> int:
    count = 0
    for _ in range(hits):
        count = tracker.record(trade_id, in_band)
    return count


class TestLossCutHelpers(unittest.TestCase):
    def test_path_progress_at_seventy_percent(self) -> None:
        trade = _trade()
        self.assertAlmostEqual(stop_loss_path_progress(trade, 96.5), 0.70)

    def test_fast_spike_exit(self) -> None:
        settings = _risk_settings()
        trade = _trade()
        self.assertTrue(
            loss_cut_should_exit(
                trade,
                95.15,
                settings,
                band_hits=0,
            )
        )

    def test_band_persistence_exit(self) -> None:
        settings = _risk_settings(loss_cut_min_band_hits=3)
        trade = _trade()
        self.assertFalse(
            loss_cut_should_exit(
                trade,
                96.5,
                settings,
                band_hits=2,
            )
        )
        self.assertTrue(
            loss_cut_should_exit(
                trade,
                96.5,
                settings,
                band_hits=3,
            )
        )

    def test_normalize_invalid_fractions(self) -> None:
        min_f, max_f = normalize_loss_cut_fractions(0.9, 0.5)
        self.assertEqual(min_f, 0.70)
        self.assertEqual(max_f, 0.90)


class TestLossCutSimExit(unittest.TestCase):
    def setUp(self) -> None:
        self.manager = RiskManager(
            settings=_risk_settings(),
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )
        self.tracker = ProfitTakeBandTracker(10)

    def test_closes_after_band_persistence(self) -> None:
        trade = _trade()
        self.manager.open_trades = [trade]
        quotes = {
            "META": Quote(
                symbol="META", price=96.5, bid=96.45, ask=None, spread=None
            ),
        }
        _record_band_hits(self.tracker, trade.id, 1)
        self.assertEqual(
            self.manager.check_loss_cut_exits(quotes, self.tracker),
            [],
        )
        closed = self.manager.check_loss_cut_exits(quotes, self.tracker)

        self.assertEqual(len(closed), 1)
        self.assertEqual(closed[0].reason, "loss_cut")
        self.assertEqual(closed[0].exit_price, 96.45)

    def test_no_exit_above_band(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(symbol="META", price=98.0, bid=None, ask=None, spread=None),
        }
        self.assertEqual(
            self.manager.check_loss_cut_exits(quotes, self.tracker),
            [],
        )

    def test_hard_stop_before_loss_cut(self) -> None:
        self.manager.open_trades = [_trade()]
        quotes = {
            "META": Quote(symbol="META", price=94.0, bid=None, ask=None, spread=None),
        }
        closed = self.manager.check_exits(quotes)
        self.assertEqual(closed[0].reason, "stop_loss")

    def test_disabled_skips_loss_cut(self) -> None:
        self.manager.settings = _risk_settings(loss_cut_enabled=False)
        trade = _trade()
        self.manager.open_trades = [trade]
        quotes = {
            "META": Quote(symbol="META", price=96.5, bid=None, ask=None, spread=None),
        }
        _record_band_hits(self.tracker, trade.id, 5)
        self.assertEqual(
            self.manager.check_loss_cut_exits(quotes, self.tracker),
            [],
        )


class TestLossCutIbkrExit(unittest.TestCase):
    def test_collect_after_band_persistence(self) -> None:
        settings = _risk_settings()
        trade = _trade(
            id="ibkr-trade-1",
            execution_mode="ibkr",
            ibkr_parent_order_id=1,
            ibkr_sl_order_id=2,
            ibkr_tp_order_id=3,
        )
        quotes = {
            "META": Quote(symbol="META", price=96.5, bid=None, ask=None, spread=None),
        }
        tracker = ProfitTakeBandTracker(10)
        _record_band_hits(tracker, trade.id, 1)
        self.assertEqual(
            collect_loss_cut_trade_ids([trade], quotes, settings, tracker),
            set(),
        )
        trade_ids = collect_loss_cut_trade_ids([trade], quotes, settings, tracker)
        self.assertEqual(trade_ids, {"ibkr-trade-1"})

        manager = RiskManager(
            settings=settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
            open_trades=[trade],
        )
        ibkr = MagicMock()
        ibkr.close_long_position.return_value = OrderFill(
            price=96.45, quantity=10.0, commission=0.0
        )
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0

        closed, closed_ids = close_ibkr_signal_exits(
            ibkr,
            manager,
            db,
            loss_cut_trade_ids=trade_ids,
            max_hold_minutes=100.0,
        )

        self.assertTrue(closed)
        self.assertEqual(closed_ids, {"ibkr-trade-1"})
        self.assertEqual(db.close_trade.call_args.kwargs["exit_reason"], "loss_cut")


if __name__ == "__main__":
    unittest.main()
