from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from models.types import ClosedTrade

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


def sync_ibkr_exits(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
) -> None:
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
