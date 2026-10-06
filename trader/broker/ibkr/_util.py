from __future__ import annotations

import asyncio
import math
from typing import Optional

from ib_insync import Trade

TERMINAL_ORDER_STATUSES = frozenset({"Filled", "Cancelled", "Inactive", "ApiCancelled"})
MARKET_DATA_COMPETING_SESSION_CODE = 10197
MARKET_DATA_TYPE_DELAYED = 3
MARKET_DATA_MIN_COVERAGE_RATIO = 0.5

MARKET_DATA_COMPETING_SESSION_MSG = (
    "IBKR error 10197 — another session (TWS, IB Gateway, or IBKR mobile) is using "
    "live market data for this account. Close other IB clients and restart Gateway, "
    "or the trader will use snapshot/delayed quotes when available."
)

_ELIGIBILITY_REJECTION_MARKERS = (
    "no trading permission",
    "customer ineligible",
    "ineligibility reasons",
    "does not have a kid",
    "appropriate kid is available",
)

_KID_REJECTION_MARKERS = (
    "does not have a kid",
    "appropriate kid is available",
    "ineligibility reasons",
)


def safe_float(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def commission_from_trade(trade: Trade) -> float:
    total = 0.0
    for fill in trade.fills or []:
        report = getattr(fill, "commissionReport", None)
        if report is None:
            continue
        commission = safe_float(getattr(report, "commission", None))
        if commission is not None:
            total += abs(commission)
    return round(total, 4)


def ticker_price(ticker: object) -> Optional[float]:
    """Best available price from an IB ticker (live, delayed, or mid)."""
    for attr in ("last", "close", "delayedLast", "marketPrice"):
        if attr == "marketPrice":
            value = getattr(ticker, "marketPrice", lambda: None)()
        else:
            value = getattr(ticker, attr, None)
        parsed = safe_float(value)
        if parsed is not None and parsed > 0:
            return parsed

    bid = safe_float(getattr(ticker, "bid", None))
    ask = safe_float(getattr(ticker, "ask", None))
    if bid is not None and ask is not None and ask >= bid > 0:
        return round((bid + ask) / 2, 6)
    return None


def describe_trade_state(trade: Trade) -> str:
    order_status = trade.orderStatus
    parts = [
        f"status={order_status.status}",
        f"filled={order_status.filled}",
        f"remaining={order_status.remaining}",
    ]
    why_held = getattr(order_status, "whyHeld", None)
    if why_held:
        parts.append(f"whyHeld={why_held!r}")
    for entry in reversed(trade.log):
        if entry.errorCode:
            message = entry.message.strip() or "(no message)"
            parts.append(f"IB {entry.errorCode}: {message}")
            break
    return ", ".join(parts)


def is_permanent_ibkr_eligibility_rejection(detail: object) -> bool:
    text = str(detail or "").lower()
    if not text:
        return False
    return any(marker in text for marker in _ELIGIBILITY_REJECTION_MARKERS)


def is_kid_document_rejection(detail: object) -> bool:
    text = str(detail or "").lower()
    if not text:
        return False
    return any(marker in text for marker in _KID_REJECTION_MARKERS)


def is_ibkr_request_timeout(exc: BaseException) -> bool:
    """True when ib_insync/IBKR did not answer within RequestTimeout."""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return True
    message = str(exc).lower()
    return "timeout" in message or "timed out" in message
