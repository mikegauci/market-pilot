from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Dict, Optional

from broker.execution import build_ibkr_flat_closed_trade
from risk.pnl import close_pnl
from models.types import ClosedTrade, ExecutionMode, OrderFill, Quote, TradeRecord
from database.command_queue import STALE_PROCESSING_SEC

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)

DB_CLOSE_RETRIES = 2


def _find_open_trade(risk_manager: RiskManager, trade_id: str) -> Optional[TradeRecord]:
    return next((t for t in risk_manager.open_trades if t.id == trade_id), None)


def _resolve_trade(
    db: SupabaseRepository,
    risk_manager: RiskManager,
    trade_id: str,
    *,
    ibkr_account_id: Optional[str] = None,
) -> Optional[TradeRecord]:
    trade = _find_open_trade(risk_manager, trade_id)
    if trade is not None:
        return trade

    open_trades = db.get_open_trades(ibkr_account_id)
    trade = next((t for t in open_trades if t.id == trade_id), None)
    if trade is not None:
        risk_manager.register_open_trade(trade)
    return trade


def _close_simulated_trade(
    risk_manager: RiskManager,
    trade: TradeRecord,
    quotes_by_symbol: Dict[str, Quote],
) -> Optional[ClosedTrade]:
    quote = quotes_by_symbol.get(trade.symbol)
    if quote is None or quote.price is None or quote.price <= 0:
        return None

    return risk_manager._build_closed_trade(trade, quote.price, "manual")


def _execute_manual_close(
    trade: TradeRecord,
    risk_manager: RiskManager,
    ibkr: IBKRClient,
    execution_mode: ExecutionMode,
    quotes_by_symbol: Dict[str, Quote],
    *,
    fill_timeout_sec: float,
) -> ClosedTrade:
    if trade.execution_mode == "ibkr":
        if execution_mode != ExecutionMode.IBKR:
            raise RuntimeError("ibkr_execution_required")
        if not ibkr.is_connected():
            raise RuntimeError("ibkr_not_connected")

        long_qty = ibkr.get_long_quantity(trade.symbol)
        if long_qty < 1:
            logger.warning(
                "Manual close %s skipped market sell — IBKR flat; closing trade in book only",
                trade.symbol,
            )
            closed = build_ibkr_flat_closed_trade(
                trade, ibkr, risk_manager, quotes_by_symbol
            )
            risk_manager.record_closed_pnl(closed.net_pnl)
            return closed

        sell_qty = min(trade.quantity, long_qty)
        if sell_qty < trade.quantity:
            logger.warning(
                "Manual close %s: selling %s of %s (IBKR long)",
                trade.symbol,
                int(sell_qty),
                int(trade.quantity),
            )

        fill: OrderFill = ibkr.close_long_position(
            trade.symbol,
            sell_qty,
            parent_order_id=trade.ibkr_parent_order_id,
            sl_order_id=trade.ibkr_sl_order_id,
            tp_order_id=trade.ibkr_tp_order_id,
            fill_timeout_sec=fill_timeout_sec,
        )
        exit_comm = (
            fill.commission
            if fill.commission > 0
            else risk_manager.estimate_ibkr_commission(fill.quantity, round_trip=False)
        )
        gross_pnl, net_pnl = close_pnl(trade, fill.price, fill.quantity, exit_comm)
        now = datetime.now(timezone.utc)
        risk_manager.record_closed_pnl(net_pnl)
        return ClosedTrade(
            trade_id=trade.id,
            symbol=trade.symbol,
            exit_price=fill.price,
            exit_time=now,
            gross_pnl=gross_pnl,
            net_pnl=net_pnl,
            reason="manual",
            filled_quantity=fill.quantity,
        )

    closed = _close_simulated_trade(risk_manager, trade, quotes_by_symbol)
    if closed is None:
        raise RuntimeError("no_market_price")
    return closed


def _persist_manual_close(
    db: SupabaseRepository,
    risk_manager: RiskManager,
    command_id: str,
    closed: ClosedTrade,
) -> bool:
    """Write close to DB with retry. Returns True when portfolio sync is needed."""
    filled_qty = closed.filled_quantity
    last_error: Optional[Exception] = None

    for attempt in range(DB_CLOSE_RETRIES):
        try:
            db.close_trade(
                closed.trade_id,
                closed.exit_price,
                closed.exit_time,
                closed.gross_pnl,
                closed.net_pnl,
                filled_quantity=filled_qty,
                exit_reason=closed.reason,
            )
            risk_manager.remove_open_trade(closed.trade_id)
            risk_manager.note_symbol_exit(closed.symbol, closed.exit_time)
            db.complete_trade_command(command_id)
            return True
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Manual close DB persist attempt %s/%s failed for %s: %s",
                attempt + 1,
                DB_CLOSE_RETRIES,
                closed.symbol,
                exc,
            )

    risk_manager.remove_open_trade(closed.trade_id)
    db.fail_trade_command(
        command_id,
        f"ibkr_filled_db_failed: {last_error}",
    )
    logger.critical(
        "Position sold for %s but DB close failed after %s attempts — "
        "reconcile trades/positions manually",
        closed.symbol,
        DB_CLOSE_RETRIES,
    )
    return True


def process_manual_close_commands(
    db: SupabaseRepository,
    risk_manager: RiskManager,
    ibkr: IBKRClient,
    execution_mode: ExecutionMode,
    quotes_by_symbol: Dict[str, Quote],
    *,
    fill_timeout_sec: float = 30.0,
    stale_processing_sec: float = STALE_PROCESSING_SEC,
    ibkr_account_id: Optional[str] = None,
) -> bool:
    """Execute pending dashboard close requests. Returns True if portfolio sync needed."""
    reclaimed = db.reclaim_stale_trade_commands(stale_processing_sec)
    if reclaimed:
        logger.info("Reclaimed %s stale manual close command(s)", reclaimed)

    commands = db.get_pending_trade_commands()
    if not commands:
        return False

    logger.info("Processing %s manual close command(s)", len(commands))
    closed_any = False

    for command in commands:
        command_id = str(command["id"])
        trade_id = str(command["trade_id"])

        if not db.claim_trade_command(command_id):
            continue

        trade = _resolve_trade(
            db, risk_manager, trade_id, ibkr_account_id=ibkr_account_id
        )
        if trade is None or trade.status != "open":
            db.fail_trade_command(command_id, "trade_not_open")
            logger.warning("Manual close skipped — trade %s not open", trade_id)
            continue

        try:
            closed = _execute_manual_close(
                trade,
                risk_manager,
                ibkr,
                execution_mode,
                quotes_by_symbol,
                fill_timeout_sec=fill_timeout_sec,
            )
            if _persist_manual_close(db, risk_manager, command_id, closed):
                closed_any = True
            logger.info(
                "Manual close %s @ $%.2f PnL $%.2f",
                closed.symbol,
                closed.exit_price,
                closed.net_pnl,
            )
        except RuntimeError as exc:
            db.fail_trade_command(command_id, str(exc))
            logger.error("Manual close failed for %s: %s", trade.symbol, exc)
        except Exception as exc:
            db.fail_trade_command(command_id, str(exc))
            logger.error("Manual close failed for %s: %s", trade.symbol, exc)

    if closed_any:
        risk_manager.set_daily_realized_pnl(
            db.get_daily_realized_pnl(ibkr_account_id)
        )

    return closed_any
