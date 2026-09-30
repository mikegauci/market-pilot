from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from models.types import Quote, RiskSettings, TradeRecord
from watchlist.jev_screener import (
    effective_benchmark,
    resolve_ranked_membership,
)

# Immediate time exit on next eval cycle when demoted max-hold ratio is 0.
IMMEDIATE_DEMOTED_HOLD_MINUTES = 0.001


def is_off_effective_watchlist(symbol: str, risk_settings: RiskSettings) -> bool:
    """True when symbol is not on the base effective watchlist (ignoring open-position merge)."""
    if not risk_settings.watchlist_dynamic_enabled:
        return False
    if risk_settings.watchlist_screener_ran_at is None:
        return False

    sym = str(symbol).upper()
    benchmark = effective_benchmark(risk_settings)
    if sym == benchmark:
        return False

    base = {str(s).upper() for s in resolve_ranked_membership(risk_settings)}
    # Empty ranked membership = no names cleared the floor (weak tape). Do not demote
    # the whole book as if each name were specifically dropped.
    if not base:
        return False
    return sym not in base


def is_demoted_symbol(symbol: str, risk_settings: RiskSettings) -> bool:
    """True when demotion exit rules apply to this symbol."""
    if not risk_settings.demotion_exits_enabled:
        return False
    return is_off_effective_watchlist(symbol, risk_settings)


def effective_max_hold_minutes(symbol: str, risk_settings: RiskSettings) -> float:
    base = float(risk_settings.max_hold_minutes)
    if base <= 0:
        return 0.0
    if not is_demoted_symbol(symbol, risk_settings):
        return base

    ratio = float(risk_settings.demotion_max_hold_ratio)
    if ratio <= 0:
        return IMMEDIATE_DEMOTED_HOLD_MINUTES
    return base * ratio


def demoted_jev_sell_loss_allowed(
    trade: TradeRecord,
    risk_settings: RiskSettings,
    quote: Quote,
) -> bool:
    if not is_demoted_symbol(trade.symbol, risk_settings):
        return False
    if not risk_settings.demotion_jev_sell_on_loss:
        return False
    if quote.price is None or trade.entry_price <= 0:
        return False

    loss_pct = (trade.entry_price - quote.price) / trade.entry_price
    # Align with the configured stop loss — no separate demotion loss cap in practice.
    return loss_pct <= float(risk_settings.stop_loss_percentage)


def min_hold_remaining_minutes(
    trade: TradeRecord,
    risk_settings: RiskSettings,
    *,
    now: Optional[datetime] = None,
) -> float:
    """Minutes left before a Jev SELL soft-exit is allowed (0 when eligible)."""
    min_hold = float(getattr(risk_settings, "min_hold_minutes", 0) or 0)
    if min_hold <= 0:
        return 0.0

    entry = trade.entry_time
    if entry.tzinfo is None:
        entry = entry.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    held_minutes = (current - entry).total_seconds() / 60.0
    return max(0.0, min_hold - held_minutes)


def price_between_entry_and_take_profit(trade: TradeRecord, price: float) -> bool:
    """True when price is above entry but still below the take-profit level."""
    if trade.entry_price <= 0 or trade.take_profit <= trade.entry_price:
        return False
    return trade.entry_price < price < trade.take_profit


def jev_sell_exit_allowed(
    trade: TradeRecord,
    risk_settings: RiskSettings,
    quote: Optional[Quote],
    *,
    now: Optional[datetime] = None,
) -> bool:
    if quote is None or quote.price is None:
        return False

    if min_hold_remaining_minutes(trade, risk_settings, now=now) > 0:
        return False

    # Let the IBKR limit TP work: do not soft-exit winners that have not reached TP,
    # unless the symbol was demoted off the watchlist (or the block is disabled).
    block_winners = bool(
        getattr(risk_settings, "soft_exit_block_winners_enabled", True)
    )
    if block_winners and price_between_entry_and_take_profit(trade, quote.price):
        if not is_demoted_symbol(trade.symbol, risk_settings):
            return False

    pnl = (quote.price - trade.entry_price) * trade.quantity
    if pnl >= 0:
        return True
    return demoted_jev_sell_loss_allowed(trade, risk_settings, quote)
