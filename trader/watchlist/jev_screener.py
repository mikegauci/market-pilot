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


def merge_effective_watchlist(
    risk_settings: RiskSettings,
    dynamic_symbols: Sequence[str],
    open_symbols: Sequence[str],
) -> List[str]:
    benchmark = effective_benchmark(risk_settings)
    merged: List[str] = []
    for raw in (
        resolve_watchlist_core(risk_settings)
        + list(dynamic_symbols)
        + list(open_symbols)
        + [benchmark]
    ):
        symbol = str(raw).upper()
        if symbol and symbol not in merged:
            merged.append(symbol)
    return merged


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
        state = build_market_state(
            quote,
            minute_bars.get(symbol),
            benchmark_minute_bars,
            trend_changes=bar_store.get_trend_changes(symbol),
            warmup_min_1m_bars=strategy_config.warmup_min_1m_bars,
        )
        if state is None:
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
    dynamic_symbols: List[str] = []
    for item in rankings:
        if item.symbol.upper() == benchmark:
            continue
        dynamic_symbols.append(item.symbol)
        if len(dynamic_symbols) >= dynamic_size:
            break
    effective = merge_effective_watchlist(risk_settings, dynamic_symbols, open_symbols)

    logger.info(
        "Jev universe scan complete — %s/%s scored, top dynamic: %s",
        len(predictions),
        len(scan_symbols),
        ", ".join(dynamic_symbols) or "(none)",
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
