"""Pure position sizing helpers (shared semantics with dashboard preview)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Optional

SizingBinding = Literal["risk", "max_position", "cash", "portfolio", "too_small", "invalid"]


@dataclass(frozen=True)
class SizingResult:
    quantity: int
    position_value: float
    requested_risk_usd: float
    planned_risk_usd: float
    risk_based_notional: float
    capped_notional: float
    sizing_binding: SizingBinding

    @property
    def ok(self) -> bool:
        return self.quantity >= 1 and self.sizing_binding not in {"too_small", "invalid"}


def compute_position_sizing(
    *,
    price: float,
    risk_per_trade: float,
    stop_loss_percentage: float,
    max_position_size: float,
    available_cash: float,
    portfolio_slots_full: bool = False,
) -> SizingResult:
    """Size long shares from dollar risk / stop distance, then apply caps.

    Order of caps: risk budget → max_position_size → available cash.
    ``portfolio_slots_full`` reports binding=portfolio without sizing a trade.
    """
    if price <= 0 or stop_loss_percentage <= 0 or risk_per_trade <= 0:
        return SizingResult(
            quantity=0,
            position_value=0.0,
            requested_risk_usd=max(0.0, float(risk_per_trade)),
            planned_risk_usd=0.0,
            risk_based_notional=0.0,
            capped_notional=0.0,
            sizing_binding="invalid",
        )

    if portfolio_slots_full:
        return SizingResult(
            quantity=0,
            position_value=0.0,
            requested_risk_usd=float(risk_per_trade),
            planned_risk_usd=0.0,
            risk_based_notional=0.0,
            capped_notional=0.0,
            sizing_binding="portfolio",
        )

    # Dollar stop distance per share; risk-based notional = risk / stop_pct.
    risk_based_notional = float(risk_per_trade) / float(stop_loss_percentage)
    capped_notional = min(float(max_position_size), risk_based_notional)
    binding: SizingBinding = (
        "max_position" if capped_notional < risk_based_notional - 1e-9 else "risk"
    )

    if available_cash < capped_notional:
        capped_notional = max(0.0, float(available_cash))
        binding = "cash"

    quantity = int(math.floor(capped_notional / price))
    if quantity < 1:
        return SizingResult(
            quantity=0,
            position_value=0.0,
            requested_risk_usd=float(risk_per_trade),
            planned_risk_usd=0.0,
            risk_based_notional=risk_based_notional,
            capped_notional=capped_notional,
            sizing_binding="too_small",
        )

    position_value = quantity * price
    planned_risk = position_value * float(stop_loss_percentage)
    return SizingResult(
        quantity=quantity,
        position_value=position_value,
        requested_risk_usd=float(risk_per_trade),
        planned_risk_usd=planned_risk,
        risk_based_notional=risk_based_notional,
        capped_notional=capped_notional,
        sizing_binding=binding,
    )


def paper_available_cash(*, account_capital: float, deployed_notional: float) -> float:
    """Paper cash cap: account_capital minus deployed notional (ignore IBKR paper cash)."""
    return max(0.0, float(account_capital) - float(deployed_notional))
