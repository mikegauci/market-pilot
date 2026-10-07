from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Dict, Optional

from broker.ibkr import is_permanent_ibkr_eligibility_rejection
from config import Settings
from models.types import ExecutionMode, Quote, TradeRecord

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager
    from runtime.state import TraderRuntimeState

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OpenTradeResult:
    opened: bool
    skip_reason: Optional[str] = None


def _rollback_ibkr_entry(
    ibkr: IBKRClient,
    trade: TradeRecord,
    *,
    fill_timeout_sec: float,
) -> None:
    """Best-effort flatten if the book write failed after a bracket fill."""
    try:
        long_qty = ibkr.get_long_quantity(trade.symbol)
        if long_qty < 1:
            return
        sell_qty = min(trade.quantity, long_qty)
        ibkr.close_long_position(
            trade.symbol,
            sell_qty,
            parent_order_id=trade.ibkr_parent_order_id,
            sl_order_id=trade.ibkr_sl_order_id,
            tp_order_id=trade.ibkr_tp_order_id,
            fill_timeout_sec=fill_timeout_sec,
        )
        logger.warning(
            "Rolled back IBKR entry for %s after book write failure (sold %s)",
            trade.symbol,
            int(sell_qty),
        )
    except Exception as exc:
        logger.critical(
            "IBKR orphan risk for %s — book write failed and rollback failed: %s",
            trade.symbol,
            exc,
        )


def open_approved_trade(
    trade: TradeRecord,
    *,
    execution_mode: ExecutionMode,
    ibkr: IBKRClient,
    db: SupabaseRepository,
    risk_manager: RiskManager,
    settings: Settings,
    runtime: TraderRuntimeState,
    quotes_by_symbol: Dict[str, Quote],
    active_ibkr_account_id: Optional[str],
    fill_timeout_sec: float,
    log_prefix: str = "",
    on_opened: Optional[Callable[[TradeRecord], None]] = None,
) -> OpenTradeResult:
    """Place sim or IBKR bracket entry and persist an open trade row."""
    prefix = f"{log_prefix} " if log_prefix else ""

    if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
        now_mono = time.monotonic()
        if trade.symbol.upper() in runtime.ibkr_entry_blocked:
            return OpenTradeResult(
                False,
                "ibkr_ineligible (no trading permission / KID)",
            )
        cooldown_until = runtime.ibkr_entry_cooldown_until.get(trade.symbol, 0.0)
        if now_mono < cooldown_until:
            remaining = cooldown_until - now_mono
            return OpenTradeResult(False, f"ibkr_cooldown ({remaining:.0f}s left)")
        if ibkr.has_pending_entry_order(trade.symbol):
            return OpenTradeResult(False, "ibkr_pending_entry_order")
        try:
            account = ibkr.get_account_summary()
            if trade.position_value > account.buying_power:
                return OpenTradeResult(
                    False,
                    "ibkr_insufficient_buying_power "
                    f"(need ${trade.position_value:.0f}, "
                    f"have ${account.buying_power:.0f})",
                )
        except Exception as exc:
            logger.warning(
                "Could not verify IBKR buying power for %s: %s",
                trade.symbol,
                exc,
            )

        try:
            bracket = ibkr.place_bracket_buy(
                trade.symbol,
                trade.quantity,
                trade.stop_loss,
                trade.take_profit,
                fill_timeout_sec=fill_timeout_sec,
            )
        except Exception as exc:
            if is_permanent_ibkr_eligibility_rejection(exc):
                blocked = trade.symbol.upper()
                runtime.ibkr_entry_blocked.add(blocked)
                return OpenTradeResult(
                    False,
                    f"ibkr_ineligible (no trading permission / KID: {exc})",
                )
            runtime.ibkr_entry_cooldown_until[trade.symbol] = (
                time.monotonic() + settings.ibkr_entry_cooldown_sec
            )
            return OpenTradeResult(False, f"ibkr_order_failed ({exc})")

        trade.execution_mode = "ibkr"
        trade.entry_price = bracket.fill_price
        trade.quantity = bracket.filled_quantity
        trade.position_value = bracket.fill_price * bracket.filled_quantity
        trade.ibkr_parent_order_id = bracket.parent_order_id
        trade.ibkr_sl_order_id = bracket.sl_order_id
        trade.ibkr_tp_order_id = bracket.tp_order_id
        trade.entry_commission = bracket.entry_commission
        trade.ibkr_account_id = active_ibkr_account_id
        try:
            db.insert_trade(trade)
            risk_manager.register_open_trade(trade)
        except Exception as exc:
            _rollback_ibkr_entry(ibkr, trade, fill_timeout_sec=fill_timeout_sec)
            raise RuntimeError(f"book_write_failed ({exc})") from exc
        if on_opened:
            on_opened(trade)
        logger.info(
            "%sIBKR BUY %s x %.0f @ $%.2f (SL $%.2f / TP $%.2f)",
            prefix,
            trade.symbol,
            trade.quantity,
            trade.entry_price,
            trade.stop_loss,
            trade.take_profit,
        )
        return OpenTradeResult(True)

    if execution_mode == ExecutionMode.IBKR:
        return OpenTradeResult(False, "ibkr_not_connected")

    trade.execution_mode = "simulated"
    trade.ibkr_account_id = active_ibkr_account_id
    snap = risk_manager.get_portfolio_snapshot(quotes_by_symbol)
    db.insert_trade(
        trade,
        alert_daily_pnl=snap.daily_pnl,
        alert_equity=snap.equity,
    )
    risk_manager.register_open_trade(trade)
    if on_opened:
        on_opened(trade)
    logger.info(
        "%sSimulated BUY %s x %.0f @ $%.2f (SL $%.2f / TP $%.2f)",
        prefix,
        trade.symbol,
        trade.quantity,
        trade.entry_price,
        trade.stop_loss,
        trade.take_profit,
    )
    return OpenTradeResult(True)
