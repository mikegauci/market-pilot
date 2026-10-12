"""Opening range breakout entries: the rule-based alternative to Jev-driven entries."""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Dict, List, Optional, Tuple

from broker.ibkr import IBKRClient
from config import Settings
from database.prediction_payload import build_rule_payload
from database.supabase import SupabaseRepository
from market.hours import is_entry_window_open, minutes_since_regular_open
from models.types import ExecutionMode, JevPrediction, MarketState, Quote, RiskSettings
from risk.manager import RiskManager
from runtime.entry_eval import EntryEvalResult, attempt_open_trade
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from strategy.filters import check_correlation_cap
from strategy.orb import evaluate_orb

logger = logging.getLogger(__name__)


def orb_filter_config(config: StrategyConfig) -> StrategyConfig:
    """Breakouts are overbought and extended by definition: drop the RSI and EMA gates."""
    return replace(config, max_rsi=100.0, entry_ema_gate="off")


def jev_vetoes(prediction: Optional[JevPrediction]) -> bool:
    if prediction is None:
        return False
    return prediction.sell > prediction.buy and prediction.sell > prediction.hold


def process_orb_states(
    *,
    ready_states: List[Tuple[str, MarketState]],
    predictions_by_symbol: Dict[str, JevPrediction],
    db: Optional[SupabaseRepository],
    risk_manager: Optional[RiskManager],
    risk_settings: RiskSettings,
    strategy_config: StrategyConfig,
    quotes_by_symbol: Dict[str, Quote],
    confirmation_tracker: ConfirmationTracker,
    bot_enabled: bool,
    execution_mode: ExecutionMode,
    ibkr: IBKRClient,
    settings: Settings,
    active_ibkr_account_id: Optional[str],
    runtime: TraderRuntimeState,
) -> EntryEvalResult:
    result = EntryEvalResult()
    if not ready_states or risk_manager is None or db is None:
        return result

    elapsed = minutes_since_regular_open()
    for symbol, state in ready_states:
        sym = symbol.upper()
        try:
            signal = evaluate_orb(
                state.price,
                runtime.orb.ranges.get(sym),
                runtime.orb.metrics.get(sym),
                risk_settings,
                strategy_config,
                elapsed,
            )
            trade_created = False
            trade_skip_reason: Optional[str] = None if signal.ok else signal.reason
            eligible = signal.ok

            # One ORB entry per stock per day, whatever max_entries_per_symbol_per_day says.
            if eligible and risk_manager.entries_today(sym) >= 1:
                trade_skip_reason = "orb_already_traded"
                eligible = False

            if eligible and risk_settings.orb_jev_veto and jev_vetoes(
                predictions_by_symbol.get(symbol)
            ):
                trade_skip_reason = "orb_jev_veto"
                eligible = False

            if not eligible:
                confirmation_tracker.record(symbol, False)
            elif not confirmation_tracker.record(symbol, True):
                current, required = confirmation_tracker.progress(symbol)
                trade_skip_reason = f"awaiting_confirmation ({current}/{required})"
                eligible = False

            if eligible and not is_entry_window_open(
                cutoff_minutes_before_close=strategy_config.entry_cutoff_minutes_before_close
            ):
                trade_skip_reason = "entry_window_closed"
                confirmation_tracker.reset(symbol)
                eligible = False

            if eligible:
                corr_filter = check_correlation_cap(
                    risk_manager.open_trades, symbol, strategy_config
                )
                if not corr_filter.passed:
                    trade_skip_reason = corr_filter.reason
                    confirmation_tracker.reset(symbol)
                    eligible = False

            if eligible:
                decision = risk_manager.evaluate_entry(
                    state,
                    predictions_by_symbol.get(symbol),
                    bot_enabled,
                    quotes_by_symbol,
                    strategy_config=strategy_config,
                    stop_pct_override=signal.stop_pct,
                    take_pct_override=signal.take_pct,
                )
                if decision.approved and decision.trade:
                    trade_created, open_skip = attempt_open_trade(
                        decision.trade,
                        symbol,
                        confirmation_tracker=confirmation_tracker,
                        db=db,
                        risk_manager=risk_manager,
                        execution_mode=execution_mode,
                        ibkr=ibkr,
                        settings=settings,
                        runtime=runtime,
                        quotes_by_symbol=quotes_by_symbol,
                        active_ibkr_account_id=active_ibkr_account_id,
                    )
                    if trade_created:
                        result.portfolio_dirty = True
                    elif open_skip:
                        trade_skip_reason = open_skip
                elif not decision.approved:
                    trade_skip_reason = decision.reason
                    logger.info("Risk: rejected %s — %s", symbol, decision.reason)

            result.prediction_rows.append(
                build_rule_payload(
                    state,
                    trade_created=trade_created,
                    trade_skip_reason=trade_skip_reason,
                )
            )
        except Exception as exc:
            logger.error("ORB processing failed for %s: %s", symbol, exc)

    return result
