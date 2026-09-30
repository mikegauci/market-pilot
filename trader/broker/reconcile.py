"""IBKR position/order reconciliation: adopt, protect-or-flatten, mismatch flags."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Callable, Iterable, List, Optional, Set

from broker.symbol_locks import EXIT_LOCKS
from models.types import BracketLegs, Position, RiskSettings, TradeRecord, TradingMode

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


@dataclass
class ReconcileResult:
    adopted: int = 0
    protected: int = 0
    flattened: int = 0
    attached_legs: int = 0
    orphan_brackets_cancelled: int = 0
    qty_mismatches: int = 0
    missing_protection: int = 0
    ok: bool = True
    detail: str = ""
    block_entries: bool = False
    events: List[dict] = field(default_factory=list)


def _compute_bracket_prices(
    entry_price: float,
    risk_settings: RiskSettings,
) -> tuple[float, float]:
    stop_loss = round(entry_price * (1 - risk_settings.stop_loss_percentage), 6)
    take_profit = round(entry_price * (1 + risk_settings.take_profit_percentage), 6)
    return stop_loss, take_profit


def _apply_bracket_legs(trade: TradeRecord, legs: BracketLegs) -> None:
    trade.ibkr_parent_order_id = legs.parent_order_id
    trade.ibkr_sl_order_id = legs.sl_order_id
    trade.ibkr_tp_order_id = legs.tp_order_id
    trade.stop_loss = legs.stop_loss
    trade.take_profit = legs.take_profit


def orphan_ibkr_symbols(
    ibkr_positions: Iterable[Position],
    open_trades: Iterable[TradeRecord],
    watchlist: Optional[Set[str]] = None,
) -> List[Position]:
    """Return IBKR long positions with no matching open trade.

    When watchlist is None, include all symbols (Phase 4 default).
    """
    tracked = {trade.symbol.upper() for trade in open_trades}
    orphans: List[Position] = []
    for position in ibkr_positions:
        if position.quantity < 1:
            continue
        symbol = position.symbol.upper()
        if watchlist is not None and symbol not in {s.upper() for s in watchlist}:
            continue
        if symbol in tracked:
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
        symbol=position.symbol.upper(),
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


def _position_qty_by_symbol(positions: Iterable[Position]) -> dict[str, float]:
    out: dict[str, float] = {}
    for position in positions:
        key = position.symbol.upper()
        out[key] = out.get(key, 0.0) + float(position.quantity)
    return out


def reconcile_cycle(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    trading_mode: TradingMode,
    risk_settings: RiskSettings,
    *,
    notifier: Optional[Callable[[str], None]] = None,
    fill_timeout_sec: float = 30.0,
) -> ReconcileResult:
    """Full reconcile: attach legs, protect-or-flatten orphans, flag mismatches."""
    result = ReconcileResult()
    if not ibkr.is_connected():
        result.ok = False
        result.detail = "ibkr_disconnected"
        result.block_entries = True
        return result

    alert = notifier or (lambda _msg: None)
    protect = bool(getattr(risk_settings, "reconcile_protect_orphans", True))

    ibkr_positions = ibkr.get_positions()
    pos_qty = _position_qty_by_symbol(ibkr_positions)

    # Attach missing legs to tracked IBKR trades; detect qty mismatches.
    for trade in list(risk_manager.open_trades):
        if trade.execution_mode != "ibkr":
            continue
        symbol = trade.symbol.upper()
        broker_qty = pos_qty.get(symbol, 0.0)
        if broker_qty < 1:
            # Flat at broker but trade still open — signal exits / sync should handle;
            # flag for visibility.
            result.qty_mismatches += 1
            result.block_entries = True
            result.ok = False
            event = {
                "symbol": symbol,
                "event_type": "qty_mismatch",
                "detail": {
                    "db_qty": trade.quantity,
                    "broker_qty": broker_qty,
                    "reason": "flat_at_broker",
                },
            }
            result.events.append(event)
            db.insert_reconciliation_event(**event)
            continue

        if abs(broker_qty - float(trade.quantity)) >= 1:
            result.qty_mismatches += 1
            result.block_entries = True
            result.ok = False
            event = {
                "symbol": symbol,
                "event_type": "qty_mismatch",
                "detail": {"db_qty": trade.quantity, "broker_qty": broker_qty},
            }
            result.events.append(event)
            db.insert_reconciliation_event(**event)
            # Prefer broker qty for protection sizing.
            trade.quantity = float(int(broker_qty))
            trade.position_value = trade.entry_price * trade.quantity

        if trade.ibkr_sl_order_id and trade.ibkr_tp_order_id:
            legs = ibkr.find_open_bracket_legs(symbol)
            if legs is None:
                result.missing_protection += 1
                result.block_entries = True
                result.ok = False
                event = {
                    "symbol": symbol,
                    "event_type": "missing_protection",
                    "detail": {"trade_id": trade.id},
                }
                result.events.append(event)
                db.insert_reconciliation_event(**event)
                with EXIT_LOCKS.hold(symbol):
                    _protect_or_flatten_tracked(
                        ibkr,
                        risk_manager,
                        db,
                        trade,
                        risk_settings,
                        protect=protect,
                        alert=alert,
                        result=result,
                        fill_timeout_sec=fill_timeout_sec,
                    )
            continue

        legs = ibkr.find_open_bracket_legs(symbol)
        if legs is not None:
            _apply_bracket_legs(trade, legs)
            db.update_trade_ibkr_bracket(trade)
            result.attached_legs += 1
            logger.info(
                "Attached IBKR bracket orders to existing %s trade (SL $%.2f / TP $%.2f)",
                symbol,
                trade.stop_loss,
                trade.take_profit,
            )
        else:
            result.missing_protection += 1
            result.block_entries = True
            result.ok = False
            with EXIT_LOCKS.hold(symbol):
                _protect_or_flatten_tracked(
                    ibkr,
                    risk_manager,
                    db,
                    trade,
                    risk_settings,
                    protect=protect,
                    alert=alert,
                    result=result,
                    fill_timeout_sec=fill_timeout_sec,
                )

    # Orphans: all IBKR longs with no open trade (including non-watchlist).
    orphans = orphan_ibkr_symbols(ibkr_positions, risk_manager.open_trades, watchlist=None)
    for position in orphans:
        symbol = position.symbol.upper()
        with EXIT_LOCKS.hold(symbol):
            legs = ibkr.find_open_bracket_legs(symbol)
            if legs is not None:
                trade = build_reconciled_trade(
                    position, risk_settings, trading_mode, legs
                )
                db.insert_trade(trade)
                risk_manager.register_open_trade(trade)
                result.adopted += 1
                event = {
                    "symbol": symbol,
                    "event_type": "adopted_existing_brackets",
                    "detail": {"qty": position.quantity, "trade_id": trade.id},
                }
                result.events.append(event)
                db.insert_reconciliation_event(**event)
                logger.info(
                    "Reconciled orphan %s with existing brackets x %.0f @ $%.2f",
                    symbol,
                    trade.quantity,
                    trade.entry_price,
                )
                continue

            stop_loss, take_profit = _compute_bracket_prices(
                position.avg_cost, risk_settings
            )
            placed: Optional[BracketLegs] = None
            if protect:
                try:
                    placed = ibkr.place_protective_orders(
                        symbol,
                        float(int(position.quantity)),
                        stop_loss,
                        take_profit,
                    )
                except Exception as exc:
                    logger.error("Protective orders failed for orphan %s: %s", symbol, exc)
                    placed = None

            if placed is not None:
                trade = build_reconciled_trade(
                    position, risk_settings, trading_mode, placed
                )
                db.insert_trade(trade)
                risk_manager.register_open_trade(trade)
                result.adopted += 1
                result.protected += 1
                event = {
                    "symbol": symbol,
                    "event_type": "adopted_protected",
                    "detail": {"qty": position.quantity, "trade_id": trade.id},
                }
                result.events.append(event)
                db.insert_reconciliation_event(**event)
                logger.info(
                    "Adopted orphan %s with new protective brackets x %.0f",
                    symbol,
                    trade.quantity,
                )
                continue

            # Flatten fallback.
            try:
                close = ibkr.close_long_position_safe(
                    symbol,
                    float(int(position.quantity)),
                    fill_timeout_sec=fill_timeout_sec,
                )
                result.flattened += 1
                msg = (
                    f"Market Pilot flattened unprotected orphan {symbol} "
                    f"x {int(position.quantity)} (protect failed)"
                )
                alert(msg)
                event = {
                    "symbol": symbol,
                    "event_type": "flattened_unprotected",
                    "detail": {
                        "qty": position.quantity,
                        "fill_price": close.fill_price,
                        "already_flat": close.already_flat,
                    },
                }
                result.events.append(event)
                db.insert_reconciliation_event(**event)
                logger.warning(msg)
            except Exception as exc:
                result.ok = False
                result.block_entries = True
                result.missing_protection += 1
                logger.error("Failed to flatten unprotected orphan %s: %s", symbol, exc)
                alert(f"Market Pilot FAILED to flatten unprotected orphan {symbol}: {exc}")
                event = {
                    "symbol": symbol,
                    "event_type": "missing_protection",
                    "detail": {"error": str(exc), "qty": position.quantity},
                }
                result.events.append(event)
                db.insert_reconciliation_event(**event)

    try:
        cancelled = ibkr.cancel_orphaned_sell_brackets()
        result.orphan_brackets_cancelled = cancelled
        if cancelled:
            event = {
                "symbol": "*",
                "event_type": "orphan_cancelled",
                "detail": {"count": cancelled},
            }
            result.events.append(event)
            db.insert_reconciliation_event(**event)
    except Exception as exc:
        logger.warning("Orphan bracket cancel failed: %s", exc)

    if result.ok and not result.block_entries:
        result.detail = (
            f"adopted={result.adopted} protected={result.protected} "
            f"flattened={result.flattened} attached={result.attached_legs}"
        )
    elif not result.detail:
        result.detail = (
            f"mismatches={result.qty_mismatches} "
            f"missing_protection={result.missing_protection} "
            f"flattened={result.flattened}"
        )
    return result


def _protect_or_flatten_tracked(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    trade: TradeRecord,
    risk_settings: RiskSettings,
    *,
    protect: bool,
    alert: Callable[[str], None],
    result: ReconcileResult,
    fill_timeout_sec: float,
) -> None:
    symbol = trade.symbol.upper()
    stop_loss, take_profit = _compute_bracket_prices(trade.entry_price, risk_settings)
    placed: Optional[BracketLegs] = None
    if protect:
        try:
            placed = ibkr.place_protective_orders(
                symbol, float(int(trade.quantity)), stop_loss, take_profit
            )
        except Exception as exc:
            logger.error("Protective orders failed for tracked %s: %s", symbol, exc)
            placed = None
    if placed is not None:
        _apply_bracket_legs(trade, placed)
        db.update_trade_ibkr_bracket(trade)
        result.protected += 1
        event = {
            "symbol": symbol,
            "event_type": "adopted_protected",
            "detail": {"trade_id": trade.id, "reprotected": True},
        }
        result.events.append(event)
        db.insert_reconciliation_event(**event)
        return

    try:
        close = ibkr.close_long_position_safe(
            symbol,
            float(int(trade.quantity)),
            parent_order_id=trade.ibkr_parent_order_id,
            sl_order_id=trade.ibkr_sl_order_id,
            tp_order_id=trade.ibkr_tp_order_id,
            fill_timeout_sec=fill_timeout_sec,
        )
        exit_price = close.fill_price if not close.already_flat else trade.entry_price
        exit_time = datetime.now(timezone.utc)
        gross = (exit_price - trade.entry_price) * trade.quantity
        db.close_trade(trade.id, exit_price, exit_time, gross, gross, exit_reason="reconcile_flatten")
        risk_manager.open_trades = [
            t for t in risk_manager.open_trades if t.id != trade.id
        ]
        risk_manager.note_symbol_exit(symbol, exit_time)
        result.flattened += 1
        msg = f"Market Pilot flattened unprotected tracked {symbol} (missing brackets)"
        alert(msg)
        event = {
            "symbol": symbol,
            "event_type": "flattened_unprotected",
            "detail": {"trade_id": trade.id},
        }
        result.events.append(event)
        db.insert_reconciliation_event(**event)
    except Exception as exc:
        result.ok = False
        result.block_entries = True
        logger.error("Failed to flatten tracked unprotected %s: %s", symbol, exc)
        alert(f"Market Pilot FAILED to flatten {symbol}: {exc}")


def reconcile_orphan_ibkr_positions(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    trading_mode: TradingMode,
    risk_settings: RiskSettings,
    watchlist: Optional[Iterable[str]] = None,
) -> int:
    """Backward-compatible startup helper; prefers full reconcile_cycle semantics.

    watchlist is ignored (Phase 4 includes non-watchlist orphans).
    """
    del watchlist
    result = reconcile_cycle(
        ibkr, risk_manager, db, trading_mode, risk_settings
    )
    return result.adopted + result.protected
