from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from jev.client import JevClient
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.indicators import build_market_state
from models.types import JevPrediction, JevRankedSymbol, MarketState, Quote, RiskSettings
from news.enrich import enrich_market_state_with_news
from news.client import NewsService
from strategy.config import StrategyConfig
from watchlist.universe import load_em_universe

logger = logging.getLogger(__name__)


def effective_benchmark(risk_settings: RiskSettings) -> str:
    """EM mode uses configured benchmark (default EEM); legacy mode keeps SPY."""
    if risk_settings.watchlist_dynamic_enabled:
        return (risk_settings.benchmark_symbol or "EEM").upper()
    return "SPY"


def resolve_watchlist_core(risk_settings: RiskSettings) -> List[str]:
    core = [str(s).upper() for s in risk_settings.watchlist_core if str(s).strip()]
    if core:
        return core
    return [str(s).upper() for s in risk_settings.watchlist if str(s).strip()]


def _merge_symbol_lists(*groups: Sequence[str]) -> List[str]:
    merged: List[str] = []
    for group in groups:
        for raw in group:
            symbol = str(raw).upper()
            if symbol and symbol not in merged:
                merged.append(symbol)
    return merged


def untradeable_benchmark_symbols(risk_settings: RiskSettings) -> set[str]:
    """Benchmarks used for context/headwind — never treat as entry symbols."""
    symbols = {effective_benchmark(risk_settings)}
    configured = str(risk_settings.benchmark_symbol or "").upper()
    if configured:
        symbols.add(configured)
    return {symbol for symbol in symbols if symbol}


def strip_benchmark_symbol(
    symbols: Sequence[str],
    risk_settings: RiskSettings,
) -> List[str]:
    """Remove benchmark symbols from tradable lists (kept for quotes/headwind only)."""
    blocked = untradeable_benchmark_symbols(risk_settings)
    return [symbol for symbol in symbols if symbol.upper() not in blocked]


def merge_core_watchlist(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str],
) -> List[str]:
    """Always-on core (+ open positions). Used when dynamic is off or as fallback."""
    return strip_benchmark_symbol(
        _merge_symbol_lists(resolve_watchlist_core(risk_settings), open_symbols),
        risk_settings,
    )


def merge_dynamic_watchlist(
    risk_settings: RiskSettings,
    dynamic_symbols: Sequence[str],
    open_symbols: Sequence[str],
) -> List[str]:
    """Top-N EM scan picks only (+ open). Does not include always-on core or benchmark."""
    return strip_benchmark_symbol(
        _merge_symbol_lists(dynamic_symbols, open_symbols),
        risk_settings,
    )


def _filter_stale_core_from_saved(
    risk_settings: RiskSettings,
    saved: Sequence[str],
) -> List[str]:
    """Drop always-on core symbols from a pre-dynamic-only union still stored in DB."""
    core = set(resolve_watchlist_core(risk_settings))
    pool_size = effective_eval_pool_size(risk_settings)
    min_buy = float(getattr(risk_settings, "watchlist_min_buy", 0.6) or 0.0)
    ranked_top: set[str] = set()
    for item in risk_settings.watchlist_jev_rankings or []:
        if item.symbol.upper() in untradeable_benchmark_symbols(risk_settings):
            continue
        if item.buy < min_buy:
            continue
        ranked_top.add(item.symbol.upper())
        if len(ranked_top) >= pool_size:
            break
    filtered: List[str] = []
    for raw in saved:
        symbol = str(raw).upper()
        if not symbol:
            continue
        # Benchmark is for headwind/context only — never keep it as a tradable name.
        if symbol in untradeable_benchmark_symbols(risk_settings):
            continue
        if symbol in core and symbol not in ranked_top:
            continue
        filtered.append(symbol)
    return filtered


def effective_eval_pool_size(risk_settings: RiskSettings) -> int:
    """Eval pool must be at least ranked membership size."""
    dynamic_size = max(0, int(risk_settings.watchlist_dynamic_size))
    pool = int(getattr(risk_settings, "watchlist_eval_pool_size", dynamic_size) or dynamic_size)
    return max(dynamic_size, pool)


def resolve_ranked_membership(risk_settings: RiskSettings) -> List[str]:
    """Top-N ranked names used for demotion / 'on list' membership.

    Prefer live rankings when present; otherwise fall back to the head of the
    saved eval-pool watchlist capped at ``watchlist_dynamic_size``.
    """
    if not risk_settings.watchlist_dynamic_enabled:
        return strip_benchmark_symbol(resolve_watchlist_core(risk_settings), risk_settings)
    if risk_settings.watchlist_screener_ran_at is None:
        return strip_benchmark_symbol(resolve_watchlist_core(risk_settings), risk_settings)

    dynamic_size = max(0, int(risk_settings.watchlist_dynamic_size))
    min_buy = float(getattr(risk_settings, "watchlist_min_buy", 0.6) or 0.0)
    benchmark = effective_benchmark(risk_settings)
    rankings = risk_settings.watchlist_jev_rankings or []
    if rankings:
        return top_dynamic_symbols(rankings, benchmark, dynamic_size, min_buy=min_buy)

    # No rankings payload — use leading slice of saved eval pool.
    saved = resolve_base_watchlist(risk_settings)
    return saved[:dynamic_size]


def resolve_base_watchlist(risk_settings: RiskSettings) -> List[str]:
    if not risk_settings.watchlist_dynamic_enabled:
        return strip_benchmark_symbol(resolve_watchlist_core(risk_settings), risk_settings)
    if risk_settings.watchlist_screener_ran_at is None:
        return strip_benchmark_symbol(resolve_watchlist_core(risk_settings), risk_settings)
    # After a successful scan, empty list is intentional (weak day / min-buy floor).
    saved = [str(symbol).upper() for symbol in risk_settings.watchlist if str(symbol).strip()]
    if not saved:
        return []
    filtered = _filter_stale_core_from_saved(risk_settings, saved)
    return filtered


def resolve_trading_watchlist(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str] = (),
) -> List[str]:
    """Trading watchlist: base symbols plus any open positions (benchmark excluded)."""
    base = resolve_base_watchlist(risk_settings)
    if not open_symbols:
        return base
    merged: List[str] = []
    for raw in list(base) + list(open_symbols):
        symbol = str(raw).upper()
        if symbol and symbol not in merged:
            merged.append(symbol)
    return strip_benchmark_symbol(merged, risk_settings)


def resolve_runtime_watchlist(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str] = (),
    *,
    env_fallback: Sequence[str] = (),
) -> List[str]:
    """Runtime watchlist for the eval loop.

    After a successful dynamic scan, an empty base list is intentional (min-BUY floor /
    weak tape) — do **not** resurrect env fallback symbols. Env fallback is only used
    when dynamic mode is off (or still waiting on first scan) and the resolved list
    is empty.
    """
    resolved = resolve_trading_watchlist(risk_settings, open_symbols)
    if resolved:
        return resolved
    intentional_empty = (
        risk_settings.watchlist_dynamic_enabled
        and risk_settings.watchlist_screener_ran_at is not None
    )
    if intentional_empty:
        return []
    fallback = [str(s).upper() for s in env_fallback if str(s).strip()]
    if not fallback:
        return []
    return strip_benchmark_symbol(
        _merge_symbol_lists(resolve_watchlist_core(risk_settings), fallback, open_symbols),
        risk_settings,
    )


def apply_screener_result_to_risk_settings(
    risk_settings: RiskSettings,
    *,
    watchlist: Sequence[str],
    rankings: Sequence[JevRankedSymbol],
    screener_ran_at: Optional[datetime],
) -> None:
    risk_settings.watchlist = [str(symbol).upper() for symbol in watchlist if str(symbol).strip()]
    risk_settings.watchlist_jev_rankings = list(rankings)
    risk_settings.watchlist_screener_ran_at = screener_ran_at


def _fetch_universe_predictions(
    jev: JevClient,
    ready_states: List[Tuple[str, MarketState]],
    max_workers: int,
) -> Dict[str, JevPrediction]:
    if not ready_states:
        return {}

    workers = min(max_workers, len(ready_states))
    predictions: Dict[str, JevPrediction] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(jev.predict, state, universe_scan=True): symbol
            for symbol, state in ready_states
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                predictions[symbol] = future.result()
            except Exception as exc:
                logger.error("Jev universe scan failed for %s: %s", symbol, exc)
    return predictions


def top_dynamic_symbols(
    rankings: Sequence[JevRankedSymbol],
    benchmark: str,
    dynamic_size: int,
    min_buy: float = 0.0,
) -> List[str]:
    """Take up to dynamic_size names with BUY >= min_buy (max, not a fill quota)."""
    symbols: List[str] = []
    benchmark_key = benchmark.upper()
    floor = max(0.0, float(min_buy))
    for item in rankings:
        if item.symbol.upper() == benchmark_key:
            continue
        if item.buy < floor:
            continue
        symbols.append(item.symbol)
        if len(symbols) >= max(0, dynamic_size):
            break
    return symbols


def rank_predictions(predictions: Dict[str, JevPrediction]) -> List[JevRankedSymbol]:
    ordered = sorted(
        predictions.values(),
        key=lambda p: (p.buy, p.buy - p.hold),
        reverse=True,
    )
    return [
        JevRankedSymbol(
            symbol=item.symbol,
            buy=item.buy,
            hold=item.hold,
            sell=item.sell,
            rank=index + 1,
        )
        for index, item in enumerate(ordered)
    ]


def _passes_screener_liquidity(
    state: MarketState,
    strategy_config: StrategyConfig,
) -> bool:
    """Skip thin/wide names before spending a Jev universe call."""
    if (
        strategy_config.min_volume_ratio > 0
        and state.volume_ratio is not None
        and state.volume_ratio < strategy_config.min_volume_ratio
    ):
        return False
    if state.spread is not None and state.price > 0:
        spread_pct = state.spread / state.price
        if spread_pct > strategy_config.max_spread_pct:
            return False
    return True


def build_universe_market_states(
    universe: Sequence[str],
    quotes_by_symbol: Dict[str, Quote],
    minute_bars: MinuteBarStore,
    benchmark_symbol: str,
    bar_store: BarStore,
    strategy_config: StrategyConfig,
    news_service: Optional[NewsService],
) -> List[Tuple[str, MarketState]]:
    benchmark_key = benchmark_symbol.upper()
    benchmark_minute_bars = minute_bars.get(benchmark_key)
    ready: List[Tuple[str, MarketState]] = []
    for symbol in universe:
        quote = quotes_by_symbol.get(symbol)
        if quote is None:
            continue
        if (
            strategy_config.min_share_price > 0
            and quote.price is not None
            and quote.price < strategy_config.min_share_price
            and symbol.upper() != benchmark_key
        ):
            continue
        state = build_market_state(
            quote,
            minute_bars.get(symbol),
            benchmark_minute_bars,
            trend_changes=bar_store.get_trend_changes(symbol),
            warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
        )
        if state is None:
            continue
        # Benchmark is scored for context; skip liquidity vetoes on it.
        if symbol.upper() != benchmark_key and not _passes_screener_liquidity(
            state, strategy_config
        ):
            continue
        ready.append(
            (symbol, enrich_market_state_with_news(state, news_service))
        )
    return ready


def run_jev_universe_scan(
    *,
    risk_settings: RiskSettings,
    jev: JevClient,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    quotes_by_symbol: Dict[str, Quote],
    open_symbols: Sequence[str],
    strategy_config: StrategyConfig,
    max_workers: int,
    news_service: Optional[NewsService] = None,
    universe_loader: Callable[[], List[str]] = load_em_universe,
) -> Tuple[List[str], List[JevRankedSymbol]]:
    """Rank EM universe with Jev and return effective watchlist + full rankings."""
    universe = universe_loader()
    benchmark = effective_benchmark(risk_settings)
    scan_symbols = list(dict.fromkeys(universe + [benchmark]))

    for symbol in scan_symbols:
        bar_store.seed_minute_aggregator(minute_bars.get(symbol), symbol)

    ready_states = build_universe_market_states(
        scan_symbols,
        quotes_by_symbol,
        minute_bars,
        benchmark,
        bar_store,
        strategy_config,
        news_service,
    )
    predictions = _fetch_universe_predictions(jev, ready_states, max_workers)
    rankings = rank_predictions(predictions)

    dynamic_size = max(0, int(risk_settings.watchlist_dynamic_size))
    min_buy = float(getattr(risk_settings, "watchlist_min_buy", 0.6) or 0.0)
    pool_size = effective_eval_pool_size(risk_settings)
    # Persist the eval pool (may be larger than ranked membership used for demotion).
    dynamic_symbols = top_dynamic_symbols(
        rankings, benchmark, pool_size, min_buy=min_buy
    )
    effective = merge_dynamic_watchlist(risk_settings, dynamic_symbols, open_symbols)

    ranked = top_dynamic_symbols(rankings, benchmark, dynamic_size, min_buy=min_buy)
    logger.info(
        "Jev universe scan complete — %s/%s scored, eval pool: %s, ranked: %s (min_buy=%.0f%%)",
        len(predictions),
        len(scan_symbols),
        ", ".join(dynamic_symbols) or "(none)",
        ", ".join(ranked) or "(none)",
        min_buy * 100,
    )
    return effective, rankings


def screener_due(
    risk_settings: RiskSettings,
    now: Optional[datetime] = None,
) -> bool:
    if not risk_settings.watchlist_dynamic_enabled:
        return False
    now = now or datetime.now(timezone.utc)
    last = risk_settings.watchlist_screener_ran_at
    if last is None:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    interval_minutes = max(1, int(risk_settings.watchlist_refresh_minutes))
    elapsed = (now - last).total_seconds() / 60.0
    return elapsed >= interval_minutes
