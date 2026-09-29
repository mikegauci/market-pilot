from __future__ import annotations

import unittest
from types import SimpleNamespace

from broker.ibkr import (
    _describe_trade_state,
    is_kid_document_rejection,
    is_permanent_ibkr_eligibility_rejection,
)


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


class TestPermanentEligibilityRejection(unittest.TestCase):
    def test_detects_kid_ineligibility(self) -> None:
        message = (
            "Parent order for EEM was inactive before fill "
            "(status=Inactive, filled=0.0, remaining=148.0, "
            "IB 201: Error 201, reqId 406: Order rejected - reason:"
            "No Trading Permission, Customer Ineligible; Ineligibility reasons:"
            "This product does not have a KID in English)"
        )
        self.assertTrue(is_permanent_ibkr_eligibility_rejection(message))

    def test_detects_no_trading_permission(self) -> None:
        self.assertTrue(
            is_permanent_ibkr_eligibility_rejection(
                "IB 201: Order rejected - reason:No Trading Permission"
            )
        )

    def test_ignores_transient_rejects(self) -> None:
        self.assertFalse(
            is_permanent_ibkr_eligibility_rejection(
                "Parent order for BABA did not fill within 60s "
                "(status=Submitted, filled=0.0, remaining=10.0)"
            )
        )
        self.assertFalse(
            is_permanent_ibkr_eligibility_rejection(
                "IB 201: Order rejected - reason:Insufficient funds"
            )
        )
        self.assertFalse(is_permanent_ibkr_eligibility_rejection(""))
        self.assertFalse(is_permanent_ibkr_eligibility_rejection(None))

    def test_kid_document_rejection_is_durable(self) -> None:
        kid_msg = (
            "IB 201: Customer Ineligible; Ineligibility reasons: "
            "This product does not have a KID in English"
        )
        self.assertTrue(is_kid_document_rejection(kid_msg))
        self.assertFalse(
            is_kid_document_rejection(
                "IB 201: Order rejected - reason:No Trading Permission"
            )
        )


if __name__ == "__main__":
    unittest.main()
