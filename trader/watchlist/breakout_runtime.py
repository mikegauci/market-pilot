from __future__ import annotations

import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Sequence

from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.session import session_change_pct_for_rotation
from models.types import Quote, RiskSettings
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from watchlist.breakout import BreakoutSignal, active_breakout_symbols, detect_breakout
from watchlist.resolution import entry_blocked_symbol_set
from watchlist.rotation import score_candidate
from watchlist.rotation_history import rotation_swap_history_entry
from watchlist.rotation_runtime import build_rotation_candidate

logger = logging.getLogger(__name__)


def maybe_promote_breakouts(
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
    entry_window_open: bool = True,
) -> tuple[RiskSettings, list[str]]:
    """Every cycle: move breaking-out pool names into the active list. Returns symbols added.

    ``breakout_max_promotions_per_cycle`` caps how many names may sit inside their
    breakout window at once, so a broad rally cannot churn the whole active list.
    """
    runtime.breakout_until_mono = {
        symbol: until
        for symbol, until in runtime.breakout_until_mono.items()
        if until > now_mono
    }
    if (
        not strategy_config.breakout_enabled
        or not market_open
        or not entry_window_open
        or not risk_settings.watchlist_rotation_enabled
        or not risk_settings.watchlist_pool
    ):
        return risk_settings, []
    slots = max(0, int(strategy_config.breakout_max_promotions_per_cycle)) - len(
        active_breakout_symbols(runtime.breakout_until_mono, now_mono)
    )
    if slots <= 0:
        return risk_settings, []

    blocked = entry_blocked_symbol_set(risk_settings)
    active = [symbol.upper() for symbol in risk_settings.watchlist_active]
    active_set = set(active)
    benchmark_change_5m = (
        benchmark_minute_bars.change_pct(5) if benchmark_minute_bars is not None else None
    )

    session_floor = strategy_config.rotation_min_session_change_pct

    signals: list[BreakoutSignal] = []
    for raw in risk_settings.watchlist_pool:
        symbol = str(raw).strip().upper()
        if not symbol or symbol in active_set or symbol in blocked:
            continue
        quote = quotes_by_symbol.get(symbol)
        aggregator = minute_bars.get(symbol)
        signal = detect_breakout(
            symbol,
            aggregator,
            quote.price if quote is not None else None,
            strategy_config,
            benchmark_change_5m=benchmark_change_5m,
        )
        if signal is None:
            continue
        # Same day-colour floor as rotation, so a promotion is not undone by the next swap.
        if session_floor is not None:
            session_pct = session_change_pct_for_rotation(
                signal.price,
                intraday_five_min_bars=(
                    bar_store.get_intraday_bars(symbol) if bar_store is not None else None
                ),
                minute_aggregator=aggregator,
            )
            if session_pct is None or session_pct < session_floor:
                continue
        signals.append(signal)
    if not signals:
        return risk_settings, []

    signals.sort(key=lambda signal: signal.change_5m, reverse=True)
    signals = signals[:slots]

    protected = {
        symbol.upper()
        for symbol in list(open_symbols) + list(confirmation_tracker.confirming_symbols())
    } | active_breakout_symbols(runtime.breakout_until_mono, now_mono)
    size = max(1, int(risk_settings.watchlist_active_size))
    scores: Dict[str, float] = {}

    def score(symbol: str) -> float:
        if symbol not in scores:
            candidate = build_rotation_candidate(
                symbol,
                quotes_by_symbol.get(symbol),
                minute_bars,
                bar_store,
                warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
            )
            scores[symbol] = score_candidate(
                candidate,
                benchmark_change_5m=benchmark_change_5m,
                benchmark_change_15m=(
                    benchmark_minute_bars.change_pct(15)
                    if benchmark_minute_bars is not None
                    else None
                ),
                min_volume_ratio=strategy_config.min_volume_ratio,
                max_rsi=strategy_config.max_rsi,
                min_session_change_pct=strategy_config.rotation_min_session_change_pct,
                entry_ema_gate=strategy_config.entry_ema_gate,
            )
        return scores[symbol]

    swapped_in: list[str] = []
    swapped_out: list[str] = []
    window_sec = max(0.0, strategy_config.breakout_window_minutes) * 60
    for signal in signals:
        if len(active) >= size:
            droppable = [symbol for symbol in active if symbol not in protected]
            if not droppable:
                break
            weakest = min(droppable, key=score)
            active.remove(weakest)
            swapped_out.append(weakest)
        active.append(signal.symbol)
        swapped_in.append(signal.symbol)
        protected.add(signal.symbol)
        runtime.breakout_until_mono[signal.symbol] = now_mono + window_sec
        logger.info(
            "Breakout: %s $%.2f above %s-min high $%.2f (5m %+.2f%%, volume x%.1f)",
            signal.symbol,
            signal.price,
            strategy_config.breakout_lookback_minutes,
            signal.prior_high,
            signal.change_5m,
            signal.volume_ratio,
        )
    if not swapped_in:
        return risk_settings, []

    note = f"breakout added {', '.join(swapped_in)}"
    if swapped_out:
        note += f" · removed {', '.join(swapped_out)}"
    logger.info("Watchlist breakout: %s -> %s", note, ", ".join(active))
    if db is not None:
        history_entry = rotation_swap_history_entry(swapped_in, swapped_out)
        if history_entry is not None:
            history_entry["detail"] = "breakout"
            # Wall-clock end of the window so the dashboard and a restarted trader agree.
            history_entry["breakout_until"] = (
                datetime.now(timezone.utc) + timedelta(seconds=window_sec)
            ).isoformat()
        try:
            # Breakouts do not reset the rotation timer, so leave its timestamp alone.
            db.save_watchlist_rotation(
                active,
                note,
                history_entry=history_entry,
                touch_rotation_at=False,
            )
        except Exception as exc:
            logger.warning("Could not save breakout promotion: %s", exc)
    return (
        replace(
            risk_settings,
            watchlist_active=active,
            watchlist_last_rotation_note=note,
        ),
        swapped_in,
    )


def restore_breakout_windows(
    runtime: TraderRuntimeState,
    history: Any,
    *,
    now_mono: float,
    now_wall: Optional[datetime] = None,
) -> list[str]:
    """Rebuild in-memory breakout windows from saved history after a restart."""
    if not isinstance(history, list):
        return []
    now_wall = now_wall or datetime.now(timezone.utc)
    restored: list[str] = []
    for entry in history:
        if not isinstance(entry, dict) or entry.get("detail") != "breakout":
            continue
        raw_until = entry.get("breakout_until")
        if not isinstance(raw_until, str):
            continue
        try:
            until = datetime.fromisoformat(raw_until)
        except ValueError:
            continue
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        remaining = (until - now_wall).total_seconds()
        if remaining <= 0:
            continue
        for raw in entry.get("added") or []:
            symbol = str(raw).strip().upper()
            if symbol and symbol not in runtime.breakout_until_mono:
                runtime.breakout_until_mono[symbol] = now_mono + remaining
                restored.append(symbol)
    return restored
