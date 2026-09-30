"""Daily-loss PnL helpers (US trading date, optional unrealized/fees)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, Optional, Sequence

from market.hours import ET, us_trading_date
from models.types import Quote, RiskSettings, TradeRecord


def et_day_bounds_utc(trading_date: date) -> tuple[datetime, datetime]:
    """Return [start, end) UTC datetimes for an America/New_York calendar date."""
    start_et = datetime(trading_date.year, trading_date.month, trading_date.day, tzinfo=ET)
    end_et = start_et + timedelta(days=1)
    return start_et.astimezone(timezone.utc), end_et.astimezone(timezone.utc)


def sum_realized_from_rows(
    rows: Sequence[dict],
    *,
    include_fees: bool,
) -> float:
    """Sum closed-trade PnL rows.

    When include_fees is False, prefer gross_pnl (pre-fee). When True, use net_pnl.
    Falls back across columns when one is missing.
    """
    total = 0.0
    for row in rows:
        if include_fees:
            value = row.get("net_pnl")
            if value is None:
                value = row.get("gross_pnl")
        else:
            value = row.get("gross_pnl")
            if value is None:
                value = row.get("net_pnl")
        if value is not None:
            total += float(value)
    return total


def unrealized_pnl(
    open_trades: Iterable[TradeRecord],
    quotes: Dict[str, Quote],
) -> float:
    total = 0.0
    for trade in open_trades:
        quote = quotes.get(trade.symbol)
        if quote is None or quote.price is None:
            continue
        total += (float(quote.price) - float(trade.entry_price)) * float(trade.quantity)
    return total


def compute_daily_loss_pnl(
    *,
    realized_pnl: float,
    open_trades: Iterable[TradeRecord],
    quotes: Dict[str, Quote],
    risk_settings: RiskSettings,
) -> float:
    """Daily PnL used for max_daily_loss (negative = loss)."""
    total = float(realized_pnl)
    if bool(getattr(risk_settings, "daily_loss_include_unrealized", True)):
        total += unrealized_pnl(open_trades, quotes)
    return total


def drawdown_frac(
    *,
    equity: float,
    peak_equity: float,
) -> float:
    """Peak-to-trough drawdown as a non-negative fraction (0 = no DD)."""
    peak = max(float(peak_equity), 0.0)
    if peak <= 0:
        return 0.0
    eq = float(equity)
    if eq >= peak:
        return 0.0
    return (peak - eq) / peak


def resolved_peak_equity(
    *,
    account_capital: float,
    history_high_water: Optional[float],
) -> float:
    peak = float(account_capital)
    if history_high_water is not None:
        peak = max(peak, float(history_high_water))
    return peak


def trading_date_for_now(now: Optional[datetime] = None) -> date:
    return us_trading_date(now)
