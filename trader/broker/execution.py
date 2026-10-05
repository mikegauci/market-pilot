from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Callable, Dict, List, Optional

from models.types import (
    ClosedTrade,
    JevPrediction,
    OrderFill,
    Position,
    Quote,
    RiskSettings,
    TradeRecord,
)
from strategy.exits import (
    normalize_profit_take_fractions,
    profit_take_should_exit,
    take_profit_path_progress,
)
from strategy.profit_take_tracker import ProfitTakeBandTracker

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)

EOD_RETRY_SEC = 30.0


def _exit_commission(
    fill: OrderFill,
    risk_manager: RiskManager,
    quantity: float,
) -> float:
    if fill.commission > 0:
        return fill.commission
    return risk_manager.estimate_ibkr_commission(quantity, round_trip=False)


def _record_ibkr_close(
    trade: TradeRecord,
    fill: OrderFill,
    reason: str,
    risk_manager: RiskManager,
    db: SupabaseRepository,
) -> None:
    entry_comm = float(getattr(trade, "entry_commission", 0) or 0)
    exit_comm = _exit_commission(fill, risk_manager, fill.quantity)
    gross_pnl = (fill.price - trade.entry_price) * fill.quantity
    net_pnl = gross_pnl - entry_comm - exit_comm
    now = datetime.now(timezone.utc)

    db.close_trade(
        trade.id,
        fill.price,
        now,
        gross_pnl,
        net_pnl,
        exit_reason=reason,
        filled_quantity=fill.quantity,
    )
    risk_manager.remove_open_trade(trade.id)
    risk_manager.record_closed_pnl(net_pnl)
    risk_manager.note_symbol_exit(trade.symbol, now)


def sync_ibkr_exits(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    *,
    ibkr_account_id: Optional[str] = None,
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
        entry_comm = float(getattr(trade, "entry_commission", 0) or 0)
        exit_comm = risk_manager.estimate_ibkr_commission(trade.quantity, round_trip=False)
        gross_pnl = (exit_price - trade.entry_price) * trade.quantity
        net_pnl = gross_pnl - entry_comm - exit_comm
        now = datetime.now(timezone.utc)

        db.close_trade(
            trade.id, exit_price, now, gross_pnl, net_pnl, exit_reason=reason
        )
        risk_manager.remove_open_trade(trade.id)
        risk_manager.record_closed_pnl(net_pnl)
        risk_manager.note_symbol_exit(trade.symbol, now)
        closed_any = True
        logger.info(
            "IBKR exit %s @ $%.2f (%s) PnL $%.2f (net)",
            trade.symbol,
            exit_price,
            reason,
            net_pnl,
        )

    if closed_any:
        risk_manager.set_daily_realized_pnl(
            db.get_daily_realized_pnl(ibkr_account_id)
        )

    return closed_any


def long_quantities_by_symbol(positions: List[Position]) -> dict[str, float]:
    return {
        position.symbol: float(position.quantity)
        for position in positions
        if position.quantity > 0
    }


def resolve_ibkr_already_flat_exit(
    trade: TradeRecord,
    ibkr: IBKRClient,
    quotes_by_symbol: Dict[str, Quote],
) -> tuple[float, str]:
    """Exit price and reason when IBKR holds no long for an open trade row."""
    if trade.ibkr_sl_order_id and trade.ibkr_tp_order_id:
        exit_info = ibkr.get_bracket_exit_status(
            trade.ibkr_parent_order_id,
            trade.ibkr_sl_order_id,
            trade.ibkr_tp_order_id,
            trade.entry_price,
            trade.quantity,
        )
        if exit_info is not None:
            return exit_info

    quote = quotes_by_symbol.get(trade.symbol)
    if quote is not None and quote.price is not None and quote.price > 0:
        return quote.price, "broker_flat"
    return trade.entry_price, "broker_flat"


def _record_ibkr_book_close(
    trade: TradeRecord,
    exit_price: float,
    reason: str,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    *,
    filled_quantity: Optional[float] = None,
) -> None:
    qty = (
        filled_quantity
        if filled_quantity is not None
        else float(trade.quantity)
    )
    entry_comm = float(getattr(trade, "entry_commission", 0) or 0)
    exit_comm = risk_manager.estimate_ibkr_commission(qty, round_trip=False)
    gross_pnl = (exit_price - trade.entry_price) * qty
    net_pnl = gross_pnl - entry_comm - exit_comm
    now = datetime.now(timezone.utc)

    db.close_trade(
        trade.id,
        exit_price,
        now,
        gross_pnl,
        net_pnl,
        exit_reason=reason,
        filled_quantity=filled_quantity,
    )
    risk_manager.remove_open_trade(trade.id)
    risk_manager.record_closed_pnl(net_pnl)
    risk_manager.note_symbol_exit(trade.symbol, now)


def build_ibkr_flat_closed_trade(
    trade: TradeRecord,
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    quotes_by_symbol: Dict[str, Quote],
) -> ClosedTrade:
    """Book-only close payload when IBKR holds no long (no market sell)."""
    exit_price, reason = resolve_ibkr_already_flat_exit(
        trade, ibkr, quotes_by_symbol
    )
    qty = float(trade.quantity)
    entry_comm = float(getattr(trade, "entry_commission", 0) or 0)
    exit_comm = risk_manager.estimate_ibkr_commission(qty, round_trip=False)
    gross_pnl = (exit_price - trade.entry_price) * qty
    net_pnl = gross_pnl - entry_comm - exit_comm
    now = datetime.now(timezone.utc)
    return ClosedTrade(
        trade_id=trade.id,
        symbol=trade.symbol,
        exit_price=exit_price,
        exit_time=now,
        gross_pnl=gross_pnl,
        net_pnl=net_pnl,
        reason=reason,
        filled_quantity=None,
    )


def reconcile_flat_ibkr_trades(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    quotes_by_symbol: Dict[str, Quote],
    *,
    ibkr_account_id: Optional[str] = None,
) -> bool:
    """Close DB trades when IBKR has no long shares (e.g. bracket filled off-book)."""
    if not ibkr.is_connected():
        return False

    long_by_symbol = long_quantities_by_symbol(ibkr.get_positions())
    closed_any = False

    for trade in list(risk_manager.open_trades):
        if trade.execution_mode != "ibkr":
            continue
        if long_by_symbol.get(trade.symbol, 0.0) >= 1:
            continue

        exit_price, reason = resolve_ibkr_already_flat_exit(
            trade, ibkr, quotes_by_symbol
        )
        _record_ibkr_book_close(trade, exit_price, reason, risk_manager, db)
        closed_any = True
        logger.info(
            "IBKR reconcile %s already flat @ $%.2f (%s)",
            trade.symbol,
            exit_price,
            reason,
        )

    if closed_any:
        risk_manager.set_daily_realized_pnl(
            db.get_daily_realized_pnl(ibkr_account_id)
        )

    return closed_any


def force_eod_ibkr_exits(
    ibkr: IBKRClient,
    risk_manager: RiskManager,
    db: SupabaseRepository,
    *,
    fill_timeout_sec: float = 30.0,
    ibkr_account_id: Optional[str] = None,
    eod_last_attempt_mono: Optional[Dict[str, float]] = None,
) -> bool:
    """Flatten all IBKR longs before the regular session close.

    Unconditional on PnL — losers are closed so positions are not held naked
    after DAY bracket orders expire at 16:00 ET.
    """
    closed_any = False
    now_mono = time.monotonic()
    attempt_map = eod_last_attempt_mono if eod_last_attempt_mono is not None else {}
    for trade in list(risk_manager.open_trades):
        if trade.execution_mode != "ibkr":
            continue
        symbol_key = trade.symbol.upper()
        last_attempt = attempt_map.get(symbol_key, 0.0)
        if now_mono - last_attempt < EOD_RETRY_SEC:
            continue
        attempt_map[symbol_key] = now_mono
        try:
            fill = ibkr.close_long_position(
                trade.symbol,
                trade.quantity,
                parent_order_id=trade.ibkr_parent_order_id,
                sl_order_id=trade.ibkr_sl_order_id,
                tp_order_id=trade.ibkr_tp_order_id,
                fill_timeout_sec=fill_timeout_sec,
            )
        except Exception as exc:
            logger.error("EOD flatten failed for %s: %s", trade.symbol, exc)
            continue

        _record_ibkr_close(trade, fill, "eod_flatten", risk_manager, db)
        closed_any = True
        logger.info(
            "EOD flatten %s @ $%.2f PnL recorded (net incl. commission)",
            trade.symbol,
            fill.price,
        )

    if closed_any:
        risk_manager.set_daily_realized_pnl(
            db.get_daily_realized_pnl(ibkr_account_id)
        )
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
    profit_take_trade_ids: Optional[set[str]] = None,
    fill_timeout_sec: float = 30.0,
    ibkr_account_id: Optional[str] = None,
) -> tuple[bool, set[str]]:
    """Close IBKR positions on time limit, profit take, or Jev SELL.

    Returns (any_closed, trade_ids_successfully_closed).
    """
    closed_any = False
    closed_trade_ids: set[str] = set()
    jev_sell_symbols = jev_sell_symbols or set()
    profit_take_trade_ids = profit_take_trade_ids or set()

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
        profit_take_exit = trade.id in profit_take_trade_ids
        if not time_exit and not jev_exit and not profit_take_exit:
            continue

        if profit_take_exit:
            reason = "profit_take"
        elif time_exit:
            reason = "time_exit"
        else:
            reason = "jev_sell"
        try:
            fill = ibkr.close_long_position(
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

        _record_ibkr_close(trade, fill, reason, risk_manager, db)
        closed_any = True
        closed_trade_ids.add(trade.id)
        logger.info(
            "IBKR exit %s @ $%.2f (%s)",
            trade.symbol,
            fill.price,
            reason,
        )

    if closed_any:
        risk_manager.set_daily_realized_pnl(
            db.get_daily_realized_pnl(ibkr_account_id)
        )

    return closed_any, closed_trade_ids


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


def collect_profit_take_trade_ids(
    open_trades: List[TradeRecord],
    quotes_by_symbol: Dict[str, Quote],
    risk_settings: RiskSettings,
    band_tracker: ProfitTakeBandTracker,
    predictions_by_symbol: Optional[Dict[str, JevPrediction]] = None,
) -> set[str]:
    """Per trade id (not symbol) so multiple legs on one symbol exit independently."""
    trade_ids: set[str] = set()
    min_fraction, max_fraction = normalize_profit_take_fractions(
        risk_settings.profit_take_min_fraction,
        risk_settings.profit_take_max_fraction,
    )
    predictions = predictions_by_symbol or {}

    if not risk_settings.profit_take_enabled:
        return set()

    for trade in open_trades:
        if trade.execution_mode != "ibkr":
            continue
        quote = quotes_by_symbol.get(trade.symbol)
        if quote is None or quote.price is None:
            band_tracker.record(trade.id, False)
            continue

        progress = take_profit_path_progress(trade, quote.price)
        in_band = (
            progress is not None
            and min_fraction <= progress <= max_fraction
        )
        band_hits = band_tracker.record(trade.id, in_band)
        prediction = predictions.get(trade.symbol)

        if profit_take_should_exit(
            trade,
            quote.price,
            risk_settings,
            band_hits=band_hits,
            prediction=prediction,
        ):
            trade_ids.add(trade.id)

    open_ids = {t.id for t in open_trades}
    band_tracker.prune(open_ids)
    return trade_ids
