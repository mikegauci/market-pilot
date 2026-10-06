from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Iterable, List, Optional, Set

from models.types import BracketLegs, Position, RiskSettings, TradeRecord, TradingMode

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


def _compute_bracket_prices(
    entry_price: float,
    risk_settings: RiskSettings,
) -> tuple[float, float]:
    stop_loss = round(entry_price * (1 - risk_settings.stop_loss_percentage), 6)
    take_profit = round(entry_price * (1 + risk_settings.take_profit_percentage), 6)
    return stop_loss, take_profit


def _apply_bracket_legs(
    trade: TradeRecord,
    legs: BracketLegs,
) -> None:
    trade.ibkr_parent_order_id = legs.parent_order_id
    trade.ibkr_sl_order_id = legs.sl_order_id
    trade.ibkr_tp_order_id = legs.tp_order_id
    trade.stop_loss = legs.stop_loss
    trade.take_profit = legs.take_profit


def nonzero_positions(ibkr_positions: Iterable[Position]) -> List[Position]:
    """Drop flat rows. Untracked holdings stay so account exposure remains visible."""
    return [position for position in ibkr_positions if abs(position.quantity) >= 1e-9]


def orphan_ibkr_symbols(
    ibkr_positions: Iterable[Position],
    open_trades: Iterable[TradeRecord],
    watchlist: Optional[Set[str]] = None,
) -> List[Position]:
    """Return IBKR long positions with no matching open trade in the database."""
    tracked = {trade.symbol for trade in open_trades}
    orphans: List[Position] = []
    for position in ibkr_positions:
        if position.quantity < 1:
            continue
        if watchlist is not None and position.symbol not in watchlist:
            continue
        if position.symbol in tracked:
            continue
        orphans.append(position)
    return orphans


def build_reconciled_trade(
    position: Position,
    risk_settings: RiskSettings,
    trading_mode: TradingMode,
    legs: Optional[BracketLegs] = None,
) -> TradeRecord:
    qty = int(position.quantity)
    entry_price = position.avg_cost
    position_value = entry_price * qty

    if legs is not None:
        stop_loss = legs.stop_loss
        take_profit = legs.take_profit
        parent_id = legs.parent_order_id
        sl_id = legs.sl_order_id
        tp_id = legs.tp_order_id
    else:
        stop_loss, take_profit = _compute_bracket_prices(entry_price, risk_settings)
        parent_id = None
        sl_id = None
        tp_id = None

    return TradeRecord(
        id=str(uuid.uuid4()),
        symbol=position.symbol,
        side="buy",
        entry_time=datetime.now(timezone.utc),
        entry_price=entry_price,
        quantity=float(qty),
        position_value=position_value,
        stop_loss=stop_loss,
        take_profit=take_profit,
        status="open",
        paper_or_live=trading_mode.value,
        jev_buy_probability=None,
        execution_mode="ibkr",
        ibkr_parent_order_id=parent_id,
        ibkr_sl_order_id=sl_id,
        ibkr_tp_order_id=tp_id,
    )


def reconcile_orphan_ibkr_positions(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    trading_mode: TradingMode,
    risk_settings: RiskSettings,
    watchlist: Optional[Iterable[str]] = None,
) -> int:
    """Adopt IBKR long positions that are not tracked in Supabase."""
    if not ibkr.is_connected():
        return 0

    watchlist_set = set(watchlist) if watchlist is not None else None
    ibkr_positions = ibkr.get_positions()
    reconciled = 0

    for trade in risk_manager.open_trades:
        if trade.execution_mode != "ibkr":
            continue
        if trade.ibkr_sl_order_id and trade.ibkr_tp_order_id:
            continue
        legs = ibkr.find_open_bracket_legs(trade.symbol)
        if legs is None:
            continue
        _apply_bracket_legs(trade, legs)
        db.update_trade_ibkr_bracket(trade)
        logger.info(
            "Attached IBKR bracket orders to existing %s trade (SL $%.2f / TP $%.2f)",
            trade.symbol,
            trade.stop_loss,
            trade.take_profit,
        )

    orphans = orphan_ibkr_symbols(
        ibkr_positions,
        risk_manager.open_trades,
        watchlist_set,
    )
    for position in orphans:
        legs = ibkr.find_open_bracket_legs(position.symbol)
        if legs is None:
            logger.warning(
                "Reconciling %s without active bracket orders — using computed SL/TP",
                position.symbol,
            )

        trade = build_reconciled_trade(position, risk_settings, trading_mode, legs)
        try:
            trade.ibkr_account_id = ibkr.get_account_summary().account_id
        except Exception:
            pass
        db.insert_trade(trade)
        risk_manager.register_open_trade(trade)
        reconciled += 1
        logger.info(
            "Reconciled orphan IBKR position: %s x %.0f @ $%.2f (SL $%.2f / TP $%.2f)",
            trade.symbol,
            trade.quantity,
            trade.entry_price,
            trade.stop_loss,
            trade.take_profit,
        )

    return reconciled


def refresh_ibkr_bracket_targets(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    *,
    open_orders_synced: bool = False,
    target_refresh_interval_sec: float = 15.0,
    last_target_refresh_mono: float = 0.0,
) -> tuple[int, float]:
    """Sync open-trade SL/TP from live IBKR bracket legs (e.g. after partial-fill resize)."""
    if not ibkr.is_connected():
        return 0, last_target_refresh_mono

    now = time.monotonic()
    throttle_target_sync = (
        target_refresh_interval_sec > 0
        and last_target_refresh_mono > 0
        and now - last_target_refresh_mono < target_refresh_interval_sec
    )

    updated = 0
    target_sync_ran = False
    for trade in risk_manager.open_trades:
        if trade.execution_mode != "ibkr":
            continue
        if not trade.ibkr_sl_order_id or not trade.ibkr_tp_order_id:
            legs = ibkr.find_open_bracket_legs(
                trade.symbol,
                open_orders_synced=open_orders_synced,
            )
            if legs is not None:
                _apply_bracket_legs(trade, legs)
                db.update_trade_ibkr_bracket(trade)
                updated += 1
            continue

        if throttle_target_sync:
            continue

        legs = ibkr.find_open_bracket_legs(
            trade.symbol,
            open_orders_synced=open_orders_synced,
        )
        target_sync_ran = True
        if legs is None:
            continue
        if (
            legs.stop_loss == trade.stop_loss
            and legs.take_profit == trade.take_profit
        ):
            continue
        _apply_bracket_legs(trade, legs)
        db.update_trade_ibkr_bracket(trade)
        updated += 1
        logger.debug(
            "Refreshed %s bracket targets from IBKR (SL $%.2f / TP $%.2f)",
            trade.symbol,
            trade.stop_loss,
            trade.take_profit,
        )

    if target_sync_ran:
        last_target_refresh_mono = now
    return updated, last_target_refresh_mono
