from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Dict, Optional

from broker.entry_open import open_approved_trade
from config import Settings
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_entry_window_open
from market.indicators import build_market_state, compute_atr_pct
from models.types import ExecutionMode, JevPrediction, Quote, TradingMode
from runtime.eval_symbols import eval_allow_five_min_fallback
from strategy.filters import check_correlation_cap

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager
    from runtime.state import TraderRuntimeState
    from strategy.config import StrategyConfig

logger = logging.getLogger(__name__)

STALE_PROCESSING_SEC = 120.0
TRANSIENT_ENTRY_REASONS = frozenset(
    {"entry_window_closed", "no_quote", "market_warming_up", "ibkr_not_connected"}
)


def _quote_for_symbol(quotes_by_symbol: Dict[str, Quote], symbol: str) -> Optional[Quote]:
    direct = quotes_by_symbol.get(symbol)
    if direct is not None:
        return direct
    upper = symbol.upper()
    direct = quotes_by_symbol.get(upper)
    if direct is not None:
        return direct
    for quote in quotes_by_symbol.values():
        if quote.symbol.upper() == upper:
            return quote
    return None


def _manual_prediction(symbol: str) -> JevPrediction:
    return JevPrediction(
        symbol=symbol,
        buy=1.0,
        hold=0.0,
        sell=0.0,
        timestamp=datetime.now(timezone.utc),
        model="manual_dashboard",
    )


def _finish_entry_command(
    db: SupabaseRepository,
    command_id: str,
    reason: str,
) -> None:
    if reason in TRANSIENT_ENTRY_REASONS or reason.startswith("ibkr_cooldown"):
        db.defer_entry_command(command_id, reason)
    else:
        db.fail_entry_command(command_id, reason)


def process_manual_entry_commands(
    db: SupabaseRepository,
    risk_manager: RiskManager,
    ibkr: IBKRClient,
    execution_mode: ExecutionMode,
    quotes_by_symbol: Dict[str, Quote],
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    strategy_config: StrategyConfig,
    settings: Settings,
    runtime: TraderRuntimeState,
    *,
    bot_enabled: bool = False,
    active_ibkr_account_id: Optional[str] = None,
    benchmark_minute_bars=None,
    benchmark_intraday_bars=None,
    fill_timeout_sec: float = 30.0,
    stale_processing_sec: float = STALE_PROCESSING_SEC,
) -> bool:
    reclaimed = db.reclaim_stale_entry_commands(stale_processing_sec)
    if reclaimed:
        logger.info("Reclaimed %s stale entry command(s)", reclaimed)

    commands = db.get_pending_entry_commands()
    if not commands:
        return False

    opened_any = False
    for command in commands:
        command_id = str(command["id"])
        symbol = str(command["symbol"]).upper()
        raw_qty = command.get("quantity")
        quantity_override = float(raw_qty) if raw_qty is not None else None

        if not db.claim_entry_command(command_id):
            continue

        try:
            if (
                risk_manager.trading_mode == TradingMode.LIVE
                and not bot_enabled
            ):
                _finish_entry_command(
                    db,
                    command_id,
                    "manual_buy_requires_bot_enabled_live",
                )
                continue

            if not is_entry_window_open(
                cutoff_minutes_before_close=strategy_config.entry_cutoff_minutes_before_close
            ):
                db.defer_entry_command(command_id, "entry_window_closed")
                continue

            quote = _quote_for_symbol(quotes_by_symbol, symbol)
            if quote is None or quote.price is None or quote.price <= 0:
                db.defer_entry_command(command_id, "no_quote")
                continue

            symbol_intraday = bar_store.get_intraday_bars(symbol)
            state = build_market_state(
                quote,
                minute_bars.get(symbol) or minute_bars.get(quote.symbol),
                benchmark_minute_bars,
                trend_changes=bar_store.get_trend_changes(symbol),
                warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
                min_live_1m_bars=strategy_config.warmup_min_1m_bars,
                allow_five_min_fallback=eval_allow_five_min_fallback(
                    False,
                    symbol_intraday,
                    strategy_config.warmup_min_1m_bars,
                ),
                symbol_intraday_bars=symbol_intraday,
                benchmark_intraday_bars=benchmark_intraday_bars,
            )
            if state is None:
                db.defer_entry_command(command_id, "market_warming_up")
                continue

            corr = check_correlation_cap(
                risk_manager.open_trades,
                symbol,
                strategy_config,
            )
            if not corr.passed:
                _finish_entry_command(db, command_id, corr.reason)
                continue

            atr_pct = compute_atr_pct(symbol_intraday)
            prediction = _manual_prediction(symbol)
            decision = risk_manager.evaluate_entry(
                state,
                prediction,
                bot_enabled=False,
                quotes_by_symbol=quotes_by_symbol,
                strategy_config=strategy_config,
                atr_pct=atr_pct,
                manual=True,
                quantity_override=quantity_override,
            )
            if not decision.approved or decision.trade is None:
                _finish_entry_command(
                    db,
                    command_id,
                    decision.reason or "rejected",
                )
                continue

            open_result = open_approved_trade(
                decision.trade,
                execution_mode=execution_mode,
                ibkr=ibkr,
                db=db,
                risk_manager=risk_manager,
                settings=settings,
                runtime=runtime,
                quotes_by_symbol=quotes_by_symbol,
                active_ibkr_account_id=active_ibkr_account_id,
                fill_timeout_sec=fill_timeout_sec,
                log_prefix="Manual",
            )
            if not open_result.opened:
                _finish_entry_command(
                    db,
                    command_id,
                    open_result.skip_reason or "rejected",
                )
                continue

            db.complete_entry_command(command_id)
            opened_any = True
        except Exception as exc:
            _finish_entry_command(db, command_id, str(exc))
            logger.error("Manual entry failed for %s: %s", symbol, exc)

    return opened_any
