from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Callable, List, Optional

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

        db.close_trade(
            trade.id, exit_price, now, gross_pnl, net_pnl, exit_reason=reason
        )
        risk_manager.remove_open_trade(trade.id)
        risk_manager.record_closed_pnl(net_pnl)
        risk_manager.note_symbol_exit(trade.symbol, now)
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
    max_hold_minutes: float = 0.0,
    max_hold_for_symbol: Optional[Callable[[str], float]] = None,
    jev_sell_symbols: Optional[set[str]] = None,
    demotion_exit_symbols: Optional[set[str]] = None,
    fill_timeout_sec: float = 30.0,
) -> bool:
    """Close IBKR positions on time limit, demotion, or high-confidence Jev SELL."""
    closed_any = False
    jev_sell_symbols = jev_sell_symbols or set()
    demotion_exit_symbols = demotion_exit_symbols or set()

    for trade in list(risk_manager.open_trades):
        if trade.execution_mode != "ibkr":
            continue

        hold_minutes = (
            max_hold_for_symbol(trade.symbol)
            if max_hold_for_symbol is not None
            else max_hold_minutes
        )
        time_exit = _trade_hold_expired(trade, hold_minutes)
        jev_exit = trade.symbol in jev_sell_symbols
        demotion_exit = trade.symbol in demotion_exit_symbols
        if not time_exit and not jev_exit and not demotion_exit:
            continue

        if demotion_exit:
            reason = "demotion_exit"
        elif time_exit:
            reason = "time_exit"
        else:
            reason = "jev_sell"
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

        db.close_trade(
            trade.id, exit_price, now, gross_pnl, net_pnl, exit_reason=reason
        )
        risk_manager.remove_open_trade(trade.id)
        risk_manager.record_closed_pnl(net_pnl)
        risk_manager.note_symbol_exit(trade.symbol, now)
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
    *,
    max_hold_for_symbol: Optional[Callable[[str], float]] = None,
) -> set[str]:
    symbols: set[str] = set()
    for trade in open_trades:
        hold_minutes = (
            max_hold_for_symbol(trade.symbol)
            if max_hold_for_symbol is not None
            else max_hold_minutes
        )
        if hold_minutes > 0 and _trade_hold_expired(trade, hold_minutes):
            symbols.add(trade.symbol)
    return symbols


def collect_demotion_exit_symbols(
    open_trades: List[TradeRecord],
    risk_settings,
) -> set[str]:
    from watchlist.demotion import is_demoted_symbol

    if not risk_settings.demotion_exits_enabled or not risk_settings.demotion_force_exit:
        return set()
    return {
        trade.symbol
        for trade in open_trades
        if trade.execution_mode == "ibkr" and is_demoted_symbol(trade.symbol, risk_settings)
    }
