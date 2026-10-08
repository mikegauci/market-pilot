from __future__ import annotations

import logging
from typing import Dict, Optional, Sequence

from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.indicators import (
    compute_intraday_from_five_min_bars,
    compute_intraday_from_live_minute_bars,
)
from market.session import session_change_pct_for_rotation
from models.types import Quote, RiskSettings
from runtime.eval_symbols import eval_allow_five_min_fallback
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from watchlist.breakout import active_breakout_symbols
from watchlist.resolution import entry_blocked_symbol_set
from watchlist.rotation import (
    RotationCandidate,
    capped_active_size,
    median_cycle_sec,
    rotate_active,
    score_candidate,
)
from watchlist.rotation_history import (
    rotation_detail_history_entry,
    rotation_swap_history_entry,
)

logger = logging.getLogger(__name__)


def build_rotation_candidate(
    symbol: str,
    quote: Optional[Quote],
    minute_bars: MinuteBarStore,
    bar_store: Optional[BarStore],
    *,
    warmup_min_1m_bars: int = 15,
) -> RotationCandidate:
    aggregator = minute_bars.get(symbol)
    price = quote.price if quote is not None else None
    change_5m = (
        aggregator.change_pct(5, price)
        if aggregator is not None and aggregator.bar_count()
        else None
    )
    change_15m = (
        aggregator.change_pct(15, price)
        if aggregator is not None and aggregator.bar_count()
        else None
    )
    rsi = None
    ema_9 = None
    ema_20 = None
    volume_ratio = None
    cached = bar_store.get_intraday_bars(symbol) if bar_store is not None else []
    live_count = aggregator.live_bar_count() if aggregator is not None else 0
    entry_aligned = None
    if price is not None and aggregator is not None and live_count >= warmup_min_1m_bars:
        entry_aligned = compute_intraday_from_live_minute_bars(aggregator, price)
    elif price is not None and cached and eval_allow_five_min_fallback(
        False, cached, warmup_min_1m_bars
    ):
        entry_aligned = compute_intraday_from_five_min_bars(cached, price)
    if entry_aligned is not None:
        if change_5m is None:
            change_5m = entry_aligned.change_5m
        if change_15m is None:
            change_15m = entry_aligned.change_15m
        rsi = entry_aligned.rsi
        ema_9 = entry_aligned.ema_9
        ema_20 = entry_aligned.ema_20
        volume_ratio = entry_aligned.volume_ratio
    elif price is not None and cached:
        intraday = compute_intraday_from_five_min_bars(cached, price)
        if change_5m is None:
            change_5m = intraday.change_5m
        if change_15m is None:
            change_15m = intraday.change_15m
        rsi = intraday.rsi
        volume_ratio = intraday.volume_ratio
    session_change_pct = session_change_pct_for_rotation(
        price,
        intraday_five_min_bars=cached or None,
        minute_aggregator=aggregator,
    )

    return RotationCandidate(
        symbol=symbol,
        change_5m=change_5m,
        change_15m=change_15m,
        volume_ratio=volume_ratio,
        rsi=rsi,
        price=price,
        ema_9=ema_9,
        ema_20=ema_20,
        session_change_pct=session_change_pct,
    )


def maybe_rotate_watchlist(
    *,
    db,
    risk_settings: RiskSettings,
    minute_bars: MinuteBarStore,
    bar_store: Optional[BarStore],
    quotes_by_symbol: Dict[str, Quote],
    benchmark_minute_bars,
    confirmation_tracker: ConfirmationTracker,
    open_symbols: Sequence[str],
    runtime: TraderRuntimeState,
    now_mono: float,
    market_open: bool,
    strategy_config: StrategyConfig,
) -> tuple[RiskSettings, list[str]]:
    """Swap at most a few active names. Returns settings and symbols newly swapped in."""
    from dataclasses import replace

    if not risk_settings.watchlist_rotation_enabled or not risk_settings.watchlist_pool:
        return risk_settings, []
    if not market_open:
        return risk_settings, []

    blocked = entry_blocked_symbol_set(risk_settings)
    current_active = [
        symbol
        for symbol in risk_settings.watchlist_active
        if symbol.upper() not in blocked
    ]
    if current_active != list(risk_settings.watchlist_active):
        note = "removed blocked symbols"
        if db is not None:
            try:
                db.save_watchlist_rotation(
                    current_active,
                    note,
                    history_entry=rotation_detail_history_entry(
                        "Removed blocked symbols from the active list"
                    ),
                )
            except Exception as exc:
                logger.warning("Could not persist trimmed active list: %s", exc)
        risk_settings = replace(
            risk_settings,
            watchlist_active=current_active,
            watchlist_last_rotation_note=note,
        )

    interval_sec = max(1, risk_settings.watchlist_rotation_interval_minutes) * 60
    due = not risk_settings.watchlist_active or (
        now_mono - runtime.last_rotation_mono
    ) >= interval_sec
    if not due:
        return risk_settings, []

    benchmark_change_5m = None
    benchmark_change_15m = None
    if benchmark_minute_bars is not None:
        benchmark_change_5m = benchmark_minute_bars.change_pct(5)
        benchmark_change_15m = benchmark_minute_bars.change_pct(15)

    protected = {
        symbol.upper()
        for symbol in list(open_symbols) + list(confirmation_tracker.confirming_symbols())
    } | active_breakout_symbols(runtime.breakout_until_mono, now_mono)
    rotation_pool = [
        symbol
        for symbol in risk_settings.watchlist_pool
        if symbol.upper() not in blocked
    ]
    scores: Dict[str, float] = {}
    for symbol in rotation_pool:
        candidate = build_rotation_candidate(
            symbol,
            quotes_by_symbol.get(symbol),
            minute_bars,
            bar_store,
            warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
        )
        scores[symbol.upper()] = score_candidate(
            candidate,
            benchmark_change_5m=benchmark_change_5m,
            benchmark_change_15m=benchmark_change_15m,
            min_volume_ratio=strategy_config.min_volume_ratio,
            max_rsi=strategy_config.max_rsi,
            min_session_change_pct=strategy_config.rotation_min_session_change_pct,
            entry_ema_gate=strategy_config.entry_ema_gate,
        )

    requested = capped_active_size(
        risk_settings.watchlist_active_size,
        len(current_active),
        median_cycle_sec(runtime.cycle_elapsed_sec),
    )
    if requested < risk_settings.watchlist_active_size:
        gap = median_cycle_sec(runtime.cycle_elapsed_sec)
        logger.warning(
            "Scan gap %.0fs — keeping active list at %s names (requested %s)",
            gap or 0,
            requested,
            risk_settings.watchlist_active_size,
        )

    result = rotate_active(
        rotation_pool,
        current_active,
        scores,
        active_size=requested,
        max_swaps=risk_settings.watchlist_max_swaps_per_rotation,
        protected=protected,
    )
    runtime.last_rotation_mono = now_mono
    if result.active == list(current_active):
        logger.info("Watchlist rotation: %s", result.note)
        if db is not None:
            try:
                db.save_watchlist_rotation(list(current_active), result.note)
            except Exception as exc:
                logger.warning("Could not save watchlist rotation scan: %s", exc)
        return (
            replace(risk_settings, watchlist_last_rotation_note=result.note),
            [],
        )

    logger.info("Watchlist rotation: %s -> %s", result.note, ", ".join(result.active))
    gap = median_cycle_sec(runtime.cycle_elapsed_sec)
    if gap:
        window_min = risk_settings.profit_take_band_window_cycles * gap / 60
        logger.info(
            "Early take-profit lookback is %s cycles (about %.1f min at the current scan gap)",
            risk_settings.profit_take_band_window_cycles,
            window_min,
        )
    if db is not None:
        try:
            db.save_watchlist_rotation(
                result.active,
                result.note,
                history_entry=rotation_swap_history_entry(
                    result.swapped_in, result.swapped_out
                ),
            )
        except Exception as exc:
            logger.warning("Could not save watchlist rotation: %s", exc)
    return (
        replace(
            risk_settings,
            watchlist_active=result.active,
            watchlist_last_rotation_note=result.note,
        ),
        list(result.swapped_in),
    )
