"""End-of-day closeout helpers."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Callable, List, Optional, Protocol

from broker.symbol_locks import EXIT_LOCKS
from models.types import Quote, TradeRecord

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


class NotifierLike(Protocol):
    def configured(self) -> bool: ...

    def send(self, message: str) -> None: ...


def in_eod_closeout_window(
    minutes_to_close: Optional[float],
    closeout_minutes: int,
    *,
    enabled: bool = True,
) -> bool:
    if not enabled or minutes_to_close is None:
        return False
    return minutes_to_close <= float(closeout_minutes)


def in_eod_flat_verify_window(
    minutes_to_close: Optional[float],
    flat_verify_minutes: int,
) -> bool:
    if minutes_to_close is None:
        return False
    return minutes_to_close <= float(flat_verify_minutes)


def entries_blocked_by_session(
    *,
    minutes_to_close: Optional[float],
    last_entry_cutoff_minutes: int,
    session_fail_closed: bool,
    session_is_open: bool,
) -> Optional[str]:
    """Return skip reason if new entries must be blocked."""
    if session_fail_closed:
        return "session_clock_error"
    if not session_is_open:
        return "market_closed"
    if minutes_to_close is not None and minutes_to_close <= float(last_entry_cutoff_minutes):
        return "last_entry_cutoff"
    return None


def flatten_open_positions_eod(
    *,
    ibkr: Optional["IBKRClient"],
    risk_manager: "RiskManager",
    db: "SupabaseRepository",
    quotes_by_symbol: dict[str, Quote],
    execution_mode_ibkr: bool,
    fill_timeout_sec: float = 30.0,
) -> bool:
    """Flatten all open positions for EOD. Safe to call every cycle until flat."""
    closed_any = False

    for trade in list(risk_manager.open_trades):
        with EXIT_LOCKS.hold(trade.symbol):
            # Re-check membership after acquiring lock.
            if not any(t.id == trade.id for t in risk_manager.open_trades):
                continue

            if execution_mode_ibkr and trade.execution_mode == "ibkr" and ibkr is not None:
                try:
                    closed = _close_ibkr_trade_safe(
                        ibkr=ibkr,
                        risk_manager=risk_manager,
                        db=db,
                        trade=trade,
                        reason="eod_closeout",
                        fill_timeout_sec=fill_timeout_sec,
                    )
                except Exception as exc:
                    logger.error("EOD flatten failed for %s: %s", trade.symbol, exc)
                    continue
                closed_any = closed_any or closed
                continue

            # Simulated path — _build_closed_trade already records PnL on the manager.
            quote = quotes_by_symbol.get(trade.symbol)
            if quote is None or quote.price is None:
                logger.warning("EOD flatten skipped %s — no quote", trade.symbol)
                continue
            closed_trade = risk_manager._build_closed_trade(
                trade, quote.price, "eod_closeout"
            )
            risk_manager.remove_open_trade(trade.id)
            risk_manager.note_symbol_exit(trade.symbol, closed_trade.exit_time)
            db.close_trade(
                closed_trade.trade_id,
                closed_trade.exit_price,
                closed_trade.exit_time,
                closed_trade.gross_pnl,
                closed_trade.net_pnl,
                exit_reason="eod_closeout",
            )
            closed_any = True
            logger.info("EOD simulated flatten %s @ $%.2f", trade.symbol, quote.price)

    if closed_any:
        risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())
    return closed_any


def _close_ibkr_trade_safe(
    *,
    ibkr: "IBKRClient",
    risk_manager: "RiskManager",
    db: "SupabaseRepository",
    trade: TradeRecord,
    reason: str,
    fill_timeout_sec: float,
) -> bool:
    """Cancel brackets, re-read broker qty, sell min(local, broker) or mark closed."""
    result = ibkr.close_long_position_safe(
        trade.symbol,
        trade.quantity,
        parent_order_id=trade.ibkr_parent_order_id,
        sl_order_id=trade.ibkr_sl_order_id,
        tp_order_id=trade.ibkr_tp_order_id,
        fill_timeout_sec=fill_timeout_sec,
    )
    now = datetime.now(timezone.utc)
    if result.already_flat:
        exit_price = trade.entry_price
        filled_qty = 0.0
        gross_pnl = 0.0
    else:
        exit_price = result.fill_price
        filled_qty = result.filled_quantity
        gross_pnl = (exit_price - trade.entry_price) * filled_qty

    net_pnl = gross_pnl
    db.close_trade(
        trade.id, exit_price, now, gross_pnl, net_pnl, exit_reason=reason
    )
    risk_manager.remove_open_trade(trade.id)
    risk_manager.record_closed_pnl(net_pnl)
    risk_manager.note_symbol_exit(trade.symbol, now)
    logger.info(
        "IBKR exit %s @ $%.2f (%s) qty=%.0f PnL $%.2f%s",
        trade.symbol,
        exit_price,
        reason,
        filled_qty,
        net_pnl,
        " already_flat" if result.already_flat else "",
    )
    return True


def verify_flat_and_alert(
    *,
    risk_manager: "RiskManager",
    notifier: NotifierLike,
    persist: Callable[..., None],
    now: Optional[datetime] = None,
) -> bool:
    """Persist flat-verify result and alert if any position remains. Returns ok."""
    stamped = now or datetime.now(timezone.utc)
    remaining = [t.symbol for t in risk_manager.open_trades]
    ok = len(remaining) == 0
    detail = "flat" if ok else f"still_open:{','.join(remaining)}"
    persist(
        verified_at=stamped,
        ok=ok,
        detail=detail,
    )
    if not ok:
        notifier.send(
            f"Market Pilot EOD flat-verify FAILED — still open: {', '.join(remaining)}"
        )
    return ok
