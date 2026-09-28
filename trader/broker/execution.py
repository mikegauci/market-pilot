from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, List, Optional

from models.types import ClosedTrade, TradeRecord

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


def sync_ibkr_exits(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
) -> bool:
    """Close DB trades when IBKR bracket SL or TP legs fill."""
    closed_any = False

    for trade in list(risk_manager.open_trades):
        if trade.execution_mode != "ibkr":
            continue
        if not trade.ibkr_sl_order_id or not trade.ibkr_tp_order_id:
            continue

        exit_info = ibkr.get_bracket_exit_status(
            trade.ibkr_parent_order_id,
            trade.ibkr_sl_order_id,
            trade.ibkr_tp_order_id,
            trade.entry_price,
            trade.quantity,
        )
        if exit_info is None:
            continue

        exit_price, reason = exit_info
        gross_pnl = (exit_price - trade.entry_price) * trade.quantity
        net_pnl = gross_pnl
        now = datetime.now(timezone.utc)

        db.close_trade(trade.id, exit_price, now, gross_pnl, net_pnl)
        risk_manager.remove_open_trade(trade.id)
        risk_manager.record_closed_pnl(net_pnl)
        closed_any = True
        logger.info(
            "IBKR exit %s @ $%.2f (%s) PnL $%.2f",
            trade.symbol,
            exit_price,
            reason,
            net_pnl,
        )

    if closed_any:
        risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())

    return closed_any


def _trade_hold_expired(trade: TradeRecord, max_hold_minutes: float) -> bool:
    if max_hold_minutes <= 0:
        return False
    hold_limit = trade.entry_time + timedelta(minutes=max_hold_minutes)
    return datetime.now(timezone.utc) >= hold_limit


def close_ibkr_signal_exits(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    *,
    max_hold_minutes: float,
    jev_sell_symbols: Optional[set[str]] = None,
    fill_timeout_sec: float = 30.0,
) -> bool:
    """Close IBKR positions on time limit or high-confidence Jev SELL."""
    closed_any = False
    jev_sell_symbols = jev_sell_symbols or set()

    for trade in list(risk_manager.open_trades):
        if trade.execution_mode != "ibkr":
            continue

        time_exit = _trade_hold_expired(trade, max_hold_minutes)
        jev_exit = trade.symbol in jev_sell_symbols
        if not time_exit and not jev_exit:
            continue

        reason = "time_exit" if time_exit else "jev_sell"
        try:
            exit_price, filled_qty = ibkr.close_long_position(
                trade.symbol,
                trade.quantity,
                parent_order_id=trade.ibkr_parent_order_id,
                sl_order_id=trade.ibkr_sl_order_id,
                tp_order_id=trade.ibkr_tp_order_id,
                fill_timeout_sec=fill_timeout_sec,
            )
        except Exception as exc:
            logger.error("IBKR signal exit failed for %s: %s", trade.symbol, exc)
            continue

        gross_pnl = (exit_price - trade.entry_price) * filled_qty
        net_pnl = gross_pnl
        now = datetime.now(timezone.utc)

        db.close_trade(trade.id, exit_price, now, gross_pnl, net_pnl)
        risk_manager.remove_open_trade(trade.id)
        risk_manager.record_closed_pnl(net_pnl)
        closed_any = True
        logger.info(
            "IBKR exit %s @ $%.2f (%s) PnL $%.2f",
            trade.symbol,
            exit_price,
            reason,
            net_pnl,
        )

    if closed_any:
        risk_manager.set_daily_realized_pnl(db.get_daily_realized_pnl())

    return closed_any


def collect_time_exit_symbols(
    open_trades: List[TradeRecord],
    max_hold_minutes: float,
) -> set[str]:
    if max_hold_minutes <= 0:
        return set()
    return {
        trade.symbol
        for trade in open_trades
        if _trade_hold_expired(trade, max_hold_minutes)
    }
