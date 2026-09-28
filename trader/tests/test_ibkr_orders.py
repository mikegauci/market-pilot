from __future__ import annotations

import unittest
from types import SimpleNamespace

from broker.ibkr import _describe_trade_state


class TestDescribeTradeState(unittest.TestCase):
    def test_includes_status_and_fill_fields(self) -> None:
        trade = SimpleNamespace(
            orderStatus=SimpleNamespace(
                status="PendingSubmit",
                filled=0.0,
                remaining=42.0,
                whyHeld="",
            ),
            log=[],
        )
        detail = _describe_trade_state(trade)  # type: ignore[arg-type]
        self.assertIn("status=PendingSubmit", detail)
        self.assertIn("filled=0.0", detail)
        self.assertIn("remaining=42.0", detail)

    def test_includes_why_held_and_ib_error(self) -> None:
        trade = SimpleNamespace(
            orderStatus=SimpleNamespace(
                status="Inactive",
                filled=0.0,
                remaining=29.0,
                whyHeld="child",
            ),
            log=[
                SimpleNamespace(errorCode=0, message=""),
                SimpleNamespace(errorCode=201, message="Order rejected"),
            ],
        )
        detail = _describe_trade_state(trade)  # type: ignore[arg-type]
        self.assertIn("whyHeld='child'", detail)
        self.assertIn("IB 201: Order rejected", detail)


if __name__ == "__main__":
    unittest.main()
