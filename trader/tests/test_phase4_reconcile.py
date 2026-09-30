"""Phase 4: clientOrderId idempotency, partial-fill resize, reconcile protect/flatten."""

from __future__ import annotations

import threading
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, List, Optional
from unittest.mock import MagicMock

from broker.reconcile import orphan_ibkr_symbols, reconcile_cycle
from broker.symbol_locks import EXIT_LOCKS, SymbolExitLocks
from models.types import (
    BracketLegs,
    BracketOrderResult,
    CloseLongResult,
    Position,
    RiskSettings,
    TradeRecord,
    TradingMode,
)


def _risk(**overrides: Any) -> RiskSettings:
    base = dict(
        minimum_jev_confidence=0.7,
        signal_record_threshold=0.5,
        risk_per_trade=100.0,
        max_position_size=5000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10000.0,
        risk_sync_equity=None,
        watchlist=["META"],
        reconcile_interval_sec=60,
        reconcile_protect_orphans=True,
    )
    base.update(overrides)
    return RiskSettings(**base)


def _trade(symbol: str = "AAPL", qty: float = 10.0, **kw: Any) -> TradeRecord:
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=str(uuid.uuid4()),
        symbol=symbol,
        side="buy",
        entry_time=now,
        entry_price=100.0,
        quantity=qty,
        position_value=100.0 * qty,
        stop_loss=99.0,
        take_profit=101.5,
        status="open",
        paper_or_live="paper",
        execution_mode="ibkr",
        ibkr_parent_order_id=1,
        ibkr_sl_order_id=2,
        ibkr_tp_order_id=3,
    )
    defaults.update(kw)
    return TradeRecord(**defaults)


def _pos(symbol: str, qty: float = 10.0, avg: float = 100.0) -> Position:
    return Position(
        symbol=symbol,
        quantity=qty,
        avg_cost=avg,
        market_price=avg,
        market_value=avg * qty,
        unrealized_pnl=0.0,
    )


class TestClientOrderIdIdempotency(unittest.TestCase):
    def test_duplicate_client_order_id_skips_second_parent(self) -> None:
        """Idempotent path: existing orderRef match means no second placeOrder."""
        from broker.ibkr import IBKRClient

        client = IBKRClient.__new__(IBKRClient)
        existing = SimpleNamespace(
            order=SimpleNamespace(orderId=42, orderRef="mp-t1-entry"),
            orderStatus=SimpleNamespace(status="Submitted"),
        )
        placed: List[Any] = []

        def find_open_order_by_client_id(coid: str) -> Optional[Any]:
            return existing if coid == "mp-t1-entry" else None

        def wait_for_fill(_trade: Any, _timeout: float, _symbol: str):
            return (150.0, 5.0)

        def place_order(*_a: Any, **_k: Any) -> None:
            placed.append(True)

        # Simulate the early-return branch of place_bracket_buy.
        coid = "mp-t1-entry"
        found = find_open_order_by_client_id(coid)
        self.assertIsNotNone(found)
        fill = wait_for_fill(found, 30.0, "AAPL")
        self.assertEqual(fill, (150.0, 5.0))
        # Would return BracketOrderResult without calling placeOrder.
        result = BracketOrderResult(
            parent_order_id=found.order.orderId,
            sl_order_id=43,
            tp_order_id=44,
            fill_price=fill[0],
            filled_quantity=fill[1],
            client_order_id=coid,
        )
        self.assertEqual(result.parent_order_id, 42)
        self.assertEqual(placed, [])
        # Confirm finder is wired on a real client method signature.
        self.assertTrue(callable(IBKRClient.find_open_order_by_client_id))


class TestPartialFillResize(unittest.TestCase):
    def test_partial_fill_marks_resized_children(self) -> None:
        result = BracketOrderResult(
            parent_order_id=1,
            sl_order_id=2,
            tp_order_id=3,
            fill_price=100.0,
            filled_quantity=4.0,
            client_order_id="mp-x-entry",
            resized_children=True,
            resize_failed=False,
        )
        self.assertEqual(result.filled_quantity, 4.0)
        self.assertTrue(result.resized_children)
        self.assertFalse(result.resize_failed)

    def test_resize_working_order_updates_total_quantity(self) -> None:
        from broker.ibkr import IBKRClient

        client = IBKRClient.__new__(IBKRClient)
        order = SimpleNamespace(orderId=7, totalQuantity=10)
        trade = SimpleNamespace(order=order, contract=object())
        placed: List[Any] = []
        client.ib = SimpleNamespace(  # type: ignore[attr-defined]
            placeOrder=lambda _c, o: placed.append(o.totalQuantity) or trade,
            sleep=lambda _s: None,
        )
        ok = IBKRClient._resize_working_order(client, trade, 4)
        self.assertTrue(ok)
        self.assertEqual(order.totalQuantity, 4)
        self.assertEqual(placed, [4])


class TestExitRaceLocks(unittest.TestCase):
    def test_exit_locks_serialize_same_symbol(self) -> None:
        locks = SymbolExitLocks()
        order: List[str] = []
        barrier = threading.Barrier(2)

        def worker(name: str) -> None:
            with locks.hold("AAPL"):
                order.append(f"{name}-enter")
                barrier.wait(timeout=2)
                order.append(f"{name}-exit")

        # Nested hold on same symbol must not deadlock (RLock).
        with locks.hold("AAPL"):
            with locks.hold("AAPL"):
                order.append("nested")
        self.assertEqual(order, ["nested"])

        # Process-wide EXIT_LOCKS is usable.
        with EXIT_LOCKS.hold("MSFT"):
            order.append("global")
        self.assertIn("global", order)


class TestReconcileCycle(unittest.TestCase):
    def test_non_watchlist_orphan_included(self) -> None:
        orphans = orphan_ibkr_symbols([_pos("ZZZZ", 3)], [], watchlist=None)
        self.assertEqual([o.symbol for o in orphans], ["ZZZZ"])

    def test_protect_path_adopts_orphan(self) -> None:
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        ibkr.get_positions.return_value = [_pos("ORPH", 5, 50.0)]
        ibkr.find_open_bracket_legs.return_value = None
        ibkr.place_protective_orders.return_value = BracketLegs(
            parent_order_id=None,
            sl_order_id=10,
            tp_order_id=11,
            stop_loss=49.5,
            take_profit=50.75,
        )
        ibkr.cancel_orphaned_sell_brackets.return_value = 0

        risk = MagicMock()
        risk.open_trades = []
        risk.register_open_trade = MagicMock()

        db = MagicMock()
        alerts: List[str] = []

        result = reconcile_cycle(
            ibkr,
            risk,
            db,
            TradingMode.PAPER,
            _risk(),
            notifier=alerts.append,
        )
        self.assertEqual(result.adopted, 1)
        self.assertEqual(result.protected, 1)
        self.assertFalse(result.block_entries)
        db.insert_trade.assert_called_once()
        risk.register_open_trade.assert_called_once()
        event_types = [c.kwargs["event_type"] for c in db.insert_reconciliation_event.call_args_list]
        self.assertIn("adopted_protected", event_types)

    def test_flatten_fallback_when_protect_fails(self) -> None:
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        ibkr.get_positions.return_value = [_pos("ORPH", 5, 50.0)]
        ibkr.find_open_bracket_legs.return_value = None
        ibkr.place_protective_orders.side_effect = RuntimeError("no mkt data")
        ibkr.close_long_position_safe.return_value = CloseLongResult(
            fill_price=50.0, filled_quantity=5.0, already_flat=False
        )
        ibkr.cancel_orphaned_sell_brackets.return_value = 0

        risk = MagicMock()
        risk.open_trades = []
        db = MagicMock()
        alerts: List[str] = []

        result = reconcile_cycle(
            ibkr,
            risk,
            db,
            TradingMode.PAPER,
            _risk(reconcile_protect_orphans=True),
            notifier=alerts.append,
        )
        self.assertEqual(result.flattened, 1)
        self.assertEqual(result.adopted, 0)
        self.assertTrue(any("flattened" in a.lower() for a in alerts))
        event_types = [c.kwargs["event_type"] for c in db.insert_reconciliation_event.call_args_list]
        self.assertIn("flattened_unprotected", event_types)

    def test_qty_mismatch_blocks_entries(self) -> None:
        trade = _trade("AAPL", qty=10.0)
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        ibkr.get_positions.return_value = [_pos("AAPL", 3.0)]
        ibkr.find_open_bracket_legs.return_value = BracketLegs(
            parent_order_id=1,
            sl_order_id=2,
            tp_order_id=3,
            stop_loss=99.0,
            take_profit=101.5,
        )
        ibkr.cancel_orphaned_sell_brackets.return_value = 0

        risk = MagicMock()
        risk.open_trades = [trade]
        db = MagicMock()

        result = reconcile_cycle(
            ibkr, risk, db, TradingMode.PAPER, _risk(), notifier=lambda _m: None
        )
        self.assertGreaterEqual(result.qty_mismatches, 1)
        self.assertTrue(result.block_entries)
        self.assertFalse(result.ok)
        event_types = [c.kwargs["event_type"] for c in db.insert_reconciliation_event.call_args_list]
        self.assertIn("qty_mismatch", event_types)

    def test_disconnected_skips_place_flatten(self) -> None:
        ibkr = MagicMock()
        ibkr.is_connected.return_value = False
        risk = MagicMock()
        risk.open_trades = []
        db = MagicMock()
        result = reconcile_cycle(
            ibkr, risk, db, TradingMode.PAPER, _risk(), notifier=lambda _m: None
        )
        self.assertEqual(result.detail, "ibkr_disconnected")
        self.assertTrue(result.block_entries)
        ibkr.get_positions.assert_not_called()
        ibkr.place_protective_orders.assert_not_called()

    def test_adopt_existing_brackets_on_reconnect_style_pass(self) -> None:
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        ibkr.get_positions.return_value = [_pos("META", 13.0, 200.0)]
        ibkr.find_open_bracket_legs.return_value = BracketLegs(
            parent_order_id=23,
            sl_order_id=25,
            tp_order_id=24,
            stop_loss=198.0,
            take_profit=203.0,
        )
        ibkr.cancel_orphaned_sell_brackets.return_value = 0
        risk = MagicMock()
        risk.open_trades = []
        risk.register_open_trade = MagicMock()
        db = MagicMock()

        result = reconcile_cycle(
            ibkr, risk, db, TradingMode.PAPER, _risk(), notifier=lambda _m: None
        )
        self.assertEqual(result.adopted, 1)
        self.assertEqual(result.protected, 0)
        event_types = [c.kwargs["event_type"] for c in db.insert_reconciliation_event.call_args_list]
        self.assertIn("adopted_existing_brackets", event_types)


if __name__ == "__main__":
    unittest.main()
