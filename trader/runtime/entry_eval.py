from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from broker.ibkr import (
    IBKRClient,
    is_kid_document_rejection,
    is_permanent_ibkr_eligibility_rejection,
)
from config import Settings
from database.prediction_payload import build_prediction_payload
from database.supabase import SupabaseRepository
from market.bars import BarStore
from market.hours import is_entry_window_open
from market.indicators import compute_atr_pct
from models.types import ExecutionMode, JevPrediction, MarketState, Quote, RiskSettings
from risk.manager import RiskManager
from runtime.state import TraderRuntimeState
from runtime.sim_close import persist_simulated_closes
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from strategy.filters import check_correlation_cap, check_entry_filters
from strategy.signals import (
    is_sell_exit_eligible,
    is_trade_eligible,
    signal_tier,
    trade_skip_reason_from_tier,
)

logger = logging.getLogger(__name__)


def log_jev_prediction(prediction: JevPrediction, tier: str) -> None:
    logger.info("%s market update", prediction.symbol)
    logger.info(
        "Jev  BUY: %.0f%%  HOLD: %.0f%%  SELL: %.0f%%",
        prediction.buy * 100,
        prediction.hold * 100,
        prediction.sell * 100,
    )
    logger.info("Signal: %s", tier)


@dataclass
class EntryEvalResult:
    prediction_rows: List[dict] = field(default_factory=list)
    portfolio_dirty: bool = False
    jev_sell_symbols: Set[str] = field(default_factory=set)


def process_ready_states(
    *,
    ready_states: List[Tuple[str, MarketState]],
    predictions_by_symbol: Dict[str, JevPrediction],
    db: Optional[SupabaseRepository],
    risk_manager: Optional[RiskManager],
    risk_settings: RiskSettings,
    strategy_config: StrategyConfig,
    runtime_entry_strategy: StrategyConfig,
    bar_store: BarStore,
    quotes_by_symbol: Dict[str, Quote],
    confirmation_tracker: ConfirmationTracker,
    bot_enabled: bool,
    execution_mode: ExecutionMode,
    ibkr: IBKRClient,
    settings: Settings,
    active_ibkr_account_id: Optional[str],
    daily_pnl_account_id: Optional[str],
    runtime: TraderRuntimeState,
) -> EntryEvalResult:
    result = EntryEvalResult()
    if not ready_states:
        return result

    for symbol, state in ready_states:
        prediction = predictions_by_symbol.get(symbol)
        if prediction is None:
            continue

        try:
            tier = signal_tier(
                prediction,
                risk_settings.signal_record_threshold,
                risk_settings.minimum_jev_confidence,
                strategy_config.min_buy_hold_margin,
                strategy_config.min_buy_sell_margin,
            )
            log_jev_prediction(prediction, tier)

            if (
                risk_manager
                and is_sell_exit_eligible(
                    prediction, strategy_config.jev_sell_exit_threshold
                )
                and risk_manager.can_jev_sell_exit(
                    symbol, quotes_by_symbol, log_skip=True
                )
            ):
                result.jev_sell_symbols.add(symbol)
                closed = risk_manager.check_jev_exit(symbol, quotes_by_symbol)
                if closed and db:
                    if persist_simulated_closes(
                        db,
                        risk_manager,
                        [closed],
                        daily_pnl_account_id=daily_pnl_account_id,
                    ):
                        result.portfolio_dirty = True

            trade_created = False
            trade_skip_reason: Optional[str] = None
            eligible = is_trade_eligible(tier)
            if not eligible:
                confirmation_tracker.record(symbol, False)
                trade_skip_reason = trade_skip_reason_from_tier(tier)
            elif not confirmation_tracker.record(symbol, True):
                current, required = confirmation_tracker.progress(symbol)
                seconds_left = confirmation_tracker.seconds_remaining(symbol)
                if seconds_left is not None and seconds_left > 0:
                    trade_skip_reason = (
                        f"awaiting_confirmation ({current}/{required}, "
                        f"{seconds_left:.0f}s left)"
                    )
                else:
                    trade_skip_reason = (
                        f"awaiting_confirmation ({current}/{required})"
                    )
                logger.info(
                    "Filter: awaiting confirmation for %s (%s)",
                    symbol,
                    trade_skip_reason,
                )
                eligible = False

            if eligible and not is_entry_window_open(
                cutoff_minutes_before_close=(
                    strategy_config.entry_cutoff_minutes_before_close
                )
            ):
                trade_skip_reason = "entry_window_closed"
                logger.info("Filter: rejected %s — entry window closed", symbol)
                confirmation_tracker.reset(symbol)
                eligible = False

            if eligible and risk_manager and db:
                entry_filter = check_entry_filters(state, runtime_entry_strategy)
                if not entry_filter.passed:
                    trade_skip_reason = entry_filter.reason
                    logger.info(
                        "Filter: rejected %s — %s",
                        symbol,
                        entry_filter.reason,
                    )
                    confirmation_tracker.reset(symbol)
                    eligible = False

                corr_filter = check_correlation_cap(
                    risk_manager.open_trades, symbol, runtime_entry_strategy
                )
                if eligible and not corr_filter.passed:
                    trade_skip_reason = corr_filter.reason
                    logger.info(
                        "Filter: rejected %s — %s",
                        symbol,
                        corr_filter.reason,
                    )
                    confirmation_tracker.reset(symbol)
                    eligible = False

            if eligible and risk_manager and db:
                atr_pct = compute_atr_pct(bar_store.get_intraday_bars(symbol))
                decision = risk_manager.evaluate_entry(
                    state,
                    prediction,
                    bot_enabled,
                    quotes_by_symbol,
                    strategy_config=runtime_entry_strategy,
                    atr_pct=atr_pct,
                )
                if decision.approved and decision.trade:
                    trade = decision.trade
                    if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
                        try:
                            ibkr_skip_reason: Optional[str] = None
                            now_mono = time.monotonic()
                            if trade.symbol.upper() in runtime.ibkr_entry_blocked:
                                ibkr_skip_reason = (
                                    "ibkr_ineligible "
                                    "(no trading permission / KID)"
                                )
                            else:
                                cooldown_until = runtime.ibkr_entry_cooldown_until.get(
                                    trade.symbol, 0.0
                                )
                                if now_mono < cooldown_until:
                                    remaining = cooldown_until - now_mono
                                    ibkr_skip_reason = (
                                        f"ibkr_cooldown ({remaining:.0f}s left)"
                                    )
                                elif ibkr.has_pending_entry_order(trade.symbol):
                                    ibkr_skip_reason = "ibkr_pending_entry_order"
                                else:
                                    try:
                                        account = ibkr.get_account_summary()
                                        if trade.position_value > account.buying_power:
                                            ibkr_skip_reason = (
                                                "ibkr_insufficient_buying_power "
                                                f"(need ${trade.position_value:.0f}, "
                                                f"have ${account.buying_power:.0f})"
                                            )
                                    except Exception as exc:
                                        logger.warning(
                                            "Could not verify IBKR buying power "
                                            "for %s: %s",
                                            trade.symbol,
                                            exc,
                                        )

                            if ibkr_skip_reason:
                                trade_skip_reason = ibkr_skip_reason
                                logger.info(
                                    "Skipping %s IBKR entry — %s",
                                    trade.symbol,
                                    ibkr_skip_reason,
                                )
                            else:
                                bracket = ibkr.place_bracket_buy(
                                    trade.symbol,
                                    trade.quantity,
                                    trade.stop_loss,
                                    trade.take_profit,
                                    fill_timeout_sec=settings.ibkr_fill_timeout_sec,
                                )
                                trade.execution_mode = "ibkr"
                                trade.entry_price = bracket.fill_price
                                trade.quantity = bracket.filled_quantity
                                trade.position_value = (
                                    bracket.fill_price * bracket.filled_quantity
                                )
                                trade.ibkr_parent_order_id = bracket.parent_order_id
                                trade.ibkr_sl_order_id = bracket.sl_order_id
                                trade.ibkr_tp_order_id = bracket.tp_order_id
                                trade.entry_commission = bracket.entry_commission
                                trade.ibkr_account_id = active_ibkr_account_id
                                db.insert_trade(trade)
                                risk_manager.register_open_trade(trade)
                                confirmation_tracker.reset(trade.symbol)
                                trade_created = True
                                result.portfolio_dirty = True
                                logger.info(
                                    "IBKR BUY %s x %.0f @ $%.2f "
                                    "(SL $%.2f / TP $%.2f)",
                                    trade.symbol,
                                    trade.quantity,
                                    trade.entry_price,
                                    trade.stop_loss,
                                    trade.take_profit,
                                )
                        except Exception as exc:
                            if is_permanent_ibkr_eligibility_rejection(exc):
                                blocked = trade.symbol.upper()
                                runtime.ibkr_entry_blocked.add(blocked)
                                trade_skip_reason = (
                                    "ibkr_ineligible "
                                    f"(no trading permission / KID: {exc})"
                                )
                                logger.error(
                                    "IBKR eligibility block for %s — "
                                    "skipping further entries this session: %s",
                                    blocked,
                                    exc,
                                )
                                if is_kid_document_rejection(exc):
                                    try:
                                        updated = db.set_em_universe_tradable(
                                            blocked, False
                                        )
                                        if updated:
                                            logger.info(
                                                "Marked %s untradable in "
                                                "em_universe (KID rejection)",
                                                blocked,
                                            )
                                        else:
                                            logger.debug(
                                                "%s not in em_universe — "
                                                "session block only",
                                                blocked,
                                            )
                                    except Exception as db_exc:
                                        logger.warning(
                                            "Could not mark %s untradable in "
                                            "em_universe: %s",
                                            blocked,
                                            db_exc,
                                        )
                            else:
                                trade_skip_reason = f"ibkr_order_failed ({exc})"
                                runtime.ibkr_entry_cooldown_until[symbol] = (
                                    time.monotonic()
                                    + settings.ibkr_entry_cooldown_sec
                                )
                                logger.error(
                                    "IBKR order failed for %s: %s", symbol, exc
                                )
                                if "PendingSubmit" in str(exc) or "whyHeld" in str(
                                    exc
                                ):
                                    logger.error(
                                        "Hint: if orders stay PendingSubmit, disable "
                                        "order confirmations in TWS/Gateway "
                                        "(Global Config → Presets → Confirmations)."
                                    )
                    elif execution_mode == ExecutionMode.IBKR:
                        trade_skip_reason = "ibkr_not_connected"
                        logger.warning(
                            "Execution mode ibkr but IBKR not connected — skipping %s",
                            symbol,
                        )
                    else:
                        trade.execution_mode = "simulated"
                        trade.ibkr_account_id = active_ibkr_account_id
                        db.insert_trade(trade)
                        risk_manager.register_open_trade(trade)
                        confirmation_tracker.reset(trade.symbol)
                        trade_created = True
                        result.portfolio_dirty = True
                        logger.info(
                            "Simulated BUY %s x %.0f @ $%.2f (SL $%.2f / TP $%.2f)",
                            trade.symbol,
                            trade.quantity,
                            trade.entry_price,
                            trade.stop_loss,
                            trade.take_profit,
                        )
                elif not decision.approved:
                    trade_skip_reason = decision.reason
                    logger.info("Risk: rejected %s — %s", symbol, decision.reason)

            if db:
                result.prediction_rows.append(
                    build_prediction_payload(
                        state,
                        prediction,
                        trade_created=trade_created,
                        trade_skip_reason=trade_skip_reason,
                    )
                )
                logger.info("Prediction queued")

        except Exception as exc:
            logger.error("Post-Jev processing failed for %s: %s", symbol, exc)

    return result
