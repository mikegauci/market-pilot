"""Phase 5: US trading-date daily loss, sticky risk_halts, drawdown breaker."""

from __future__ import annotations

import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

from market.hours import ET, us_trading_date
from models.types import Quote, RiskSettings, TradeRecord
from risk.daily_pnl import (
    compute_daily_loss_pnl,
    drawdown_frac,
    et_day_bounds_utc,
    resolved_peak_equity,
    sum_realized_from_rows,
)
from risk.halts import RiskHaltCoordinator
from strategy.pre_submit import pre_submit_recheck


def _risk(**overrides: Any) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.7,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=5000.0,
        max_daily_loss=100.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10000.0,
        risk_sync_equity=None,
        watchlist=["AAPL"],
        daily_loss_include_unrealized=True,
        daily_loss_include_fees=False,
        daily_loss_action="block_entries",
        drawdown_breaker_enabled=False,
        drawdown_max_frac=0.10,
    )
    base.update(overrides)
    return RiskSettings(**base)


def _trade(symbol: str = "AAPL", qty: float = 10.0, entry: float = 100.0) -> TradeRecord:
    return TradeRecord(
        id=str(uuid.uuid4()),
        symbol=symbol,
        side="buy",
        entry_time=datetime.now(timezone.utc),
        entry_price=entry,
        quantity=qty,
        position_value=entry * qty,
        stop_loss=entry * 0.99,
        take_profit=entry * 1.015,
        status="open",
        paper_or_live="paper",
        execution_mode="simulated",
    )


def _quote(symbol: str, price: float) -> Quote:
    return Quote(
        symbol=symbol,
        price=price,
        bid=price - 0.01,
        ask=price + 0.01,
        spread=0.02,
        received_at=datetime.now(timezone.utc),
    )


class TestUsTradingDate(unittest.TestCase):
    def test_et_day_bounds_span_midnight(self) -> None:
        day = date(2026, 6, 15)
        start, end = et_day_bounds_utc(day)
        self.assertEqual(start.astimezone(ET).date(), day)
        self.assertEqual((end - start), timedelta(days=1))
        # Exit just before ET midnight belongs to day; at midnight next day.
        almost = end - timedelta(seconds=1)
        self.assertEqual(almost.astimezone(ET).date(), day)
        self.assertEqual(end.astimezone(ET).date(), date(2026, 6, 16))

    def test_us_trading_date_uses_et(self) -> None:
        # 2026-06-16 02:00 UTC = 2026-06-15 22:00 ET
        now = datetime(2026, 6, 16, 2, 0, tzinfo=timezone.utc)
        self.assertEqual(us_trading_date(now), date(2026, 6, 15))


class TestDailyPnlFlags(unittest.TestCase):
    def test_include_fees_uses_net(self) -> None:
        rows = [{"gross_pnl": -50.0, "net_pnl": -55.0}]
        self.assertEqual(sum_realized_from_rows(rows, include_fees=False), -50.0)
        self.assertEqual(sum_realized_from_rows(rows, include_fees=True), -55.0)

    def test_include_unrealized_toggle(self) -> None:
        trade = _trade("AAPL", 10, 100.0)
        quotes = {"AAPL": _quote("AAPL", 90.0)}  # -100 unrealized
        settings_on = _risk(daily_loss_include_unrealized=True)
        settings_off = _risk(daily_loss_include_unrealized=False)
        self.assertEqual(
            compute_daily_loss_pnl(
                realized_pnl=-10.0,
                open_trades=[trade],
                quotes=quotes,
                risk_settings=settings_on,
            ),
            -110.0,
        )
        self.assertEqual(
            compute_daily_loss_pnl(
                realized_pnl=-10.0,
                open_trades=[trade],
                quotes=quotes,
                risk_settings=settings_off,
            ),
            -10.0,
        )


class TestRiskHaltCoordinator(unittest.TestCase):
    def test_sticky_halt_survives_mtm_recovery(self) -> None:
        coord = RiskHaltCoordinator()
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = -150.0
        db.insert_risk_halt.return_value = True
        risk = MagicMock()
        risk.open_trades = []
        risk.set_daily_realized_pnl = MagicMock()
        settings = _risk(max_daily_loss=100.0)
        alerts: List[str] = []

        first = coord.evaluate(
            risk_manager=risk,
            risk_settings=settings,
            db=db,
            quotes_by_symbol={},
            notifier=alerts.append,
        )
        self.assertTrue(first.state.active)
        self.assertTrue(first.newly_tripped)
        self.assertEqual(coord.entry_blocked(), "max_daily_loss")

        # Recovery: realized now only -10 but sticky remains.
        db.get_daily_realized_pnl.return_value = -10.0
        second = coord.evaluate(
            risk_manager=risk,
            risk_settings=settings,
            db=db,
            quotes_by_symbol={},
            notifier=alerts.append,
        )
        self.assertTrue(second.state.active)
        self.assertFalse(second.newly_tripped)
        self.assertEqual(len(alerts), 1)

    def test_clears_on_next_us_date(self) -> None:
        coord = RiskHaltCoordinator()
        coord.state.active = True
        coord.state.halt_type = "daily_loss"
        coord.state.reason = "daily_loss"
        coord.state.trading_date = date(2026, 6, 15)
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0
        db.insert_risk_halt.return_value = True
        risk = MagicMock()
        risk.open_trades = []
        risk.set_daily_realized_pnl = MagicMock()
        # Next calendar day ET
        now = datetime(2026, 6, 16, 14, 0, tzinfo=ET)
        result = coord.evaluate(
            risk_manager=risk,
            risk_settings=_risk(),
            db=db,
            quotes_by_symbol={},
            now=now.astimezone(timezone.utc),
            notifier=lambda _m: None,
        )
        self.assertFalse(result.state.active)
        self.assertIsNone(coord.entry_blocked())

    def test_flatten_and_block_requests_flatten(self) -> None:
        coord = RiskHaltCoordinator()
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = -200.0
        db.insert_risk_halt.return_value = True
        risk = MagicMock()
        risk.open_trades = []
        risk.set_daily_realized_pnl = MagicMock()
        result = coord.evaluate(
            risk_manager=risk,
            risk_settings=_risk(
                max_daily_loss=50.0, daily_loss_action="flatten_and_block"
            ),
            db=db,
            quotes_by_symbol={},
            notifier=lambda _m: None,
        )
        self.assertTrue(result.flatten_requested)
        self.assertEqual(result.state.action_taken, "flatten_and_block")

    def test_drawdown_disabled_does_not_trip(self) -> None:
        coord = RiskHaltCoordinator()
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0
        risk = MagicMock()
        risk.open_trades = []
        risk.set_daily_realized_pnl = MagicMock()
        result = coord.evaluate(
            risk_manager=risk,
            risk_settings=_risk(drawdown_breaker_enabled=False, drawdown_max_frac=0.05),
            db=db,
            quotes_by_symbol={},
            equity=8000.0,
            history_high_water=10000.0,
            notifier=lambda _m: None,
        )
        self.assertFalse(result.state.active)
        self.assertGreaterEqual(result.state.drawdown_frac, 0.2)

    def test_drawdown_enabled_trips(self) -> None:
        coord = RiskHaltCoordinator()
        db = MagicMock()
        db.get_daily_realized_pnl.return_value = 0.0
        db.insert_risk_halt.return_value = True
        risk = MagicMock()
        risk.open_trades = []
        risk.set_daily_realized_pnl = MagicMock()
        result = coord.evaluate(
            risk_manager=risk,
            risk_settings=_risk(
                drawdown_breaker_enabled=True,
                drawdown_max_frac=0.10,
                max_daily_loss=999999.0,
            ),
            db=db,
            quotes_by_symbol={},
            equity=8500.0,
            history_high_water=10000.0,
            notifier=lambda _m: None,
        )
        self.assertTrue(result.state.active)
        self.assertEqual(result.state.halt_type, "drawdown")
        self.assertEqual(coord.entry_blocked(), "drawdown_halt")

    def test_hydrate_active_halt(self) -> None:
        coord = RiskHaltCoordinator()
        db = MagicMock()
        db.clear_stale_risk_halts.return_value = 0
        db.get_active_risk_halts.return_value = [
            {
                "halt_type": "daily_loss",
                "action_taken": "block_entries",
                "trading_date": date.today().isoformat(),
            }
        ]
        state = coord.hydrate(db)
        self.assertTrue(state.active)
        self.assertEqual(coord.entry_blocked(), "max_daily_loss")


class TestDrawdownHelpers(unittest.TestCase):
    def test_peak_and_frac(self) -> None:
        peak = resolved_peak_equity(account_capital=10000.0, history_high_water=12000.0)
        self.assertEqual(peak, 12000.0)
        self.assertAlmostEqual(drawdown_frac(equity=10800.0, peak_equity=peak), 0.1)


class TestPreSubmitQuotes(unittest.TestCase):
    def test_open_quotes_include_other_positions(self) -> None:
        risk = MagicMock()
        open_aapl = _trade("AAPL", 10, 100.0)
        open_msft = _trade("MSFT", 10, 200.0)
        risk.open_trades = [open_aapl, open_msft]
        risk._available_cash.return_value = 100000.0

        # Only candidate fresh quote would miss MSFT unrealized (-2000).
        # With open_quotes, total unrealized = AAPL 0 + MSFT -2000 + realized 0 = -2000
        # but max_daily_loss is 100 → should trip when full map passed.
        seen: Dict[str, Any] = {}

        def _daily_pnl(quotes: Dict[str, Quote]) -> float:
            seen["keys"] = sorted(quotes.keys())
            total = 0.0
            for t in risk.open_trades:
                q = quotes.get(t.symbol)
                if q and q.price is not None:
                    total += (q.price - t.entry_price) * t.quantity
            return total

        risk._daily_pnl.side_effect = _daily_pnl
        settings = _risk(max_daily_loss=100.0, stale_input_gates_enabled=False)

        fresh = _quote("TSLA", 50.0)
        open_quotes = {
            "AAPL": _quote("AAPL", 100.0),
            "MSFT": _quote("MSFT", 180.0),  # -200 unrealized
        }

        result = pre_submit_recheck(
            symbol="TSLA",
            decision_price=50.0,
            fresh_quote=fresh,
            risk_manager=risk,
            risk_settings=settings,
            bot_enabled=True,
            entry_kill_active=False,
            entry_block=None,
            open_quotes=open_quotes,
        )
        self.assertIn("MSFT", seen["keys"])
        self.assertIn("AAPL", seen["keys"])
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "max_daily_loss")

    def test_risk_halt_reason_blocks(self) -> None:
        risk = MagicMock()
        risk.open_trades = []
        settings = _risk(stale_input_gates_enabled=False)
        result = pre_submit_recheck(
            symbol="AAPL",
            decision_price=100.0,
            fresh_quote=_quote("AAPL", 100.0),
            risk_manager=risk,
            risk_settings=settings,
            bot_enabled=True,
            entry_kill_active=False,
            entry_block=None,
            risk_halt_reason="drawdown_halt",
        )
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "drawdown_halt")


if __name__ == "__main__":
    unittest.main()
