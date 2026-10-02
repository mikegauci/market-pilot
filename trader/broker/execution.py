from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Callable, Dict, List, Optional

from models.types import ClosedTrade, JevPrediction, OrderFill, Quote, RiskSettings, TradeRecord
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
    demotion_exit_symbols: Optional[set[str]] = None,
    profit_take_trade_ids: Optional[set[str]] = None,
    fill_timeout_sec: float = 30.0,
    ibkr_account_id: Optional[str] = None,
) -> tuple[bool, set[str]]:
    """Close IBKR positions on time limit, demotion, profit take, or Jev SELL.

    Returns (any_closed, trade_ids_successfully_closed).
    """
    closed_any = False
    closed_trade_ids: set[str] = set()
    jev_sell_symbols = jev_sell_symbols or set()
    demotion_exit_symbols = demotion_exit_symbols or set()
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
        demotion_exit = trade.symbol in demotion_exit_symbols
        profit_take_exit = trade.id in profit_take_trade_ids
        if not time_exit and not jev_exit and not demotion_exit and not profit_take_exit:
            continue

        if demotion_exit:
            reason = "demotion_exit"
        elif profit_take_exit:
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
