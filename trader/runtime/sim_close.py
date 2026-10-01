from __future__ import annotations

from typing import TYPE_CHECKING, List, Optional

from models.types import ClosedTrade

if TYPE_CHECKING:
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager


def persist_simulated_closes(
    db: "SupabaseRepository",
    risk_manager: "RiskManager",
    closed_trades: List[ClosedTrade],
    *,
    daily_pnl_account_id: Optional[str] = None,
) -> bool:
    """Write simulated closes to Supabase and refresh daily PnL. Returns True if any closed."""
    if not closed_trades:
        return False
    for closed_trade in closed_trades:
        db.close_trade(
            closed_trade.trade_id,
            closed_trade.exit_price,
            closed_trade.exit_time,
            closed_trade.gross_pnl,
            closed_trade.net_pnl,
            exit_reason=closed_trade.reason,
        )
        risk_manager.note_symbol_exit(closed_trade.symbol, closed_trade.exit_time)
    risk_manager.set_daily_realized_pnl(
        db.get_daily_realized_pnl(daily_pnl_account_id)
    )
    return True
