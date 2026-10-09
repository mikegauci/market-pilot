"""Closed-trade P&L math shared by simulated, IBKR bracket, reconcile and manual closes."""
from __future__ import annotations

from typing import Tuple

from models.types import TradeRecord


def entry_commission(trade: TradeRecord) -> float:
    return float(getattr(trade, "entry_commission", 0) or 0)


def close_pnl(
    trade: TradeRecord,
    exit_price: float,
    quantity: float,
    exit_commission: float,
) -> Tuple[float, float]:
    """(gross, net) for closing `quantity` of a long at `exit_price`, net of both commissions."""
    gross_pnl = (exit_price - trade.entry_price) * quantity
    net_pnl = gross_pnl - entry_commission(trade) - exit_commission
    return gross_pnl, net_pnl
