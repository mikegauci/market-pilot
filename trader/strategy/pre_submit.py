"""Pre-submit recheck helpers (fresh quote, ask sizing, kill/cutoff/daily-loss, drift)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from models.types import Quote, RiskSettings
from risk.manager import RiskManager
from risk.sizing import compute_position_sizing
from strategy.data_gates import GateResult, check_price_drift, check_quote_fresh_for_symbol, quote_age_sec


@dataclass
class PreSubmitResult:
    ok: bool
    reason: str = ""
    quantity: float = 0.0
    position_value: float = 0.0
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0


def pre_submit_recheck(
    *,
    symbol: str,
    decision_price: float,
    fresh_quote: Optional[Quote],
    risk_manager: RiskManager,
    risk_settings: RiskSettings,
    bot_enabled: bool,
    entry_kill_active: bool,
    entry_block: Optional[str],
    prediction_ts: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> PreSubmitResult:
    """Re-validate gates with a fresh snapshot before transmitting a bracket.

    Signal age is measured here (submit time), not at prediction receipt.
    """
    now_u = now or datetime.now(timezone.utc)
    if not bot_enabled:
        return PreSubmitResult(False, "bot_disabled")
    if entry_kill_active:
        return PreSubmitResult(False, "entry_kill_active")
    if entry_block:
        return PreSubmitResult(False, entry_block)

    if risk_settings.stale_input_gates_enabled:
        from strategy.data_gates import check_signal_age

        sage = check_signal_age(
            prediction_ts,
            now=now_u,
            max_signal_age_sec=float(risk_settings.max_signal_age_sec),
        )
        if not sage.passed:
            return PreSubmitResult(False, sage.reason)

    if fresh_quote is None or (fresh_quote.ask is None and fresh_quote.price is None):
        return PreSubmitResult(False, "missing_fresh_quote")

    enforce = bool(risk_settings.stale_input_gates_enabled)
    age = quote_age_sec(
        now=now_u,
        received_at=fresh_quote.received_at,
        exchange_at=fresh_quote.exchange_at,
    )
    freshness = check_quote_fresh_for_symbol(
        age, risk_settings.max_quote_age_sec, enforce=enforce
    )
    if not freshness.passed:
        return PreSubmitResult(False, freshness.reason)

    ask = fresh_quote.ask if fresh_quote.ask and fresh_quote.ask > 0 else fresh_quote.price
    if ask is None or ask <= 0:
        return PreSubmitResult(False, "invalid_fresh_price")

    if risk_settings.pre_submit_recheck_enabled:
        drift = check_price_drift(
            decision_price, float(ask), risk_settings.max_entry_price_drift_frac
        )
        if not drift.passed:
            return PreSubmitResult(False, drift.reason)

    quotes_by_symbol = {fresh_quote.symbol: fresh_quote}
    if risk_manager._daily_pnl(quotes_by_symbol) <= -risk_settings.max_daily_loss:
        return PreSubmitResult(False, "max_daily_loss")

    sizing = compute_position_sizing(
        price=float(ask),
        risk_per_trade=risk_settings.risk_per_trade,
        stop_loss_percentage=risk_settings.stop_loss_percentage,
        max_position_size=risk_settings.max_position_size,
        available_cash=risk_manager._available_cash(),
        portfolio_slots_full=len(risk_manager.open_trades)
        >= risk_settings.max_open_positions,
    )
    if not sizing.ok:
        return PreSubmitResult(False, f"sizing_{sizing.sizing_binding}")

    entry_price = float(ask)
    stop_loss = entry_price * (1 - risk_settings.stop_loss_percentage)
    take_profit = entry_price * (1 + risk_settings.take_profit_percentage)
    return PreSubmitResult(
        True,
        quantity=float(sizing.quantity),
        position_value=float(sizing.position_value),
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit=take_profit,
    )
