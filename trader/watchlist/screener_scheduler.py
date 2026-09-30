from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

from broker.ibkr import IBKRClient
from config import Settings
from database.supabase import SupabaseRepository
from jev.client import JevClient
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_us_regular_session_open
from market.mock import MockMarketProvider
from models.types import DataSource, JevRankedSymbol, Quote, RiskSettings
from news.client import NewsService
from strategy.config import StrategyConfig
from watchlist.jev_screener import (
    apply_screener_result_to_risk_settings,
    effective_benchmark,
    merge_core_watchlist,
    merge_dynamic_watchlist,
    run_jev_universe_scan,
    screener_due,
    top_dynamic_symbols,
)
from watchlist.universe import load_em_universe

logger = logging.getLogger(__name__)

SCREENER_FAILURE_BACKOFF_SEC = 300.0
MIN_SCORED_RATIO = 0.15
CACHE_COVERAGE_RATIO = 0.70
MIN_INTRADAY_BARS = 30
BACKFILL_CLIENT_ID_OFFSET = 100


def _ensure_thread_event_loop() -> None:
    """ib_insync needs an asyncio loop in the calling thread (not only the main thread)."""
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)


def _connect_backfill_ibkr(settings: Settings) -> IBKRClient:
    """Dedicated IB session for background bar backfill (separate client id + event loop)."""
    _ensure_thread_event_loop()
    client = IBKRClient(
        host=settings.ibkr_host,
        port=settings.ibkr_port,
        client_id=settings.ibkr_client_id + BACKFILL_CLIENT_ID_OFFSET,
        account=settings.ibkr_account,
        market_data_type=settings.ibkr_market_data_type,
    )
    client.connect()
    return client


def quotes_from_minute_bars(
    minute_bars: MinuteBarStore,
    symbols: Sequence[str],
    bar_store: Optional[BarStore] = None,
) -> List[Quote]:
    """Build quotes from seeded minute bars — safe off the IBKR main thread."""
    quotes: List[Quote] = []
    for symbol in symbols:
        key = symbol.upper()
        closes = minute_bars.get(key).closes()
        price = closes[-1] if closes else None
        volume: Optional[int] = None
        if bar_store is not None:
            intraday = bar_store.get_intraday_bars(key)
            if intraday:
                volume = sorted(intraday, key=lambda bar: bar.ts)[-1].volume
        quotes.append(
            Quote(
                symbol=key,
                price=price,
                bid=None,
                ask=None,
                spread=None,
                volume=volume,
            )
        )
    return quotes


def merge_quote_liquidity(
    bar_quotes: Sequence[Quote],
    snapshot: Optional[Dict[str, Quote]],
) -> List[Quote]:
    """Overlay bid/ask/spread from a main-thread snapshot onto bar-derived prices.

    Screener workers cannot safely call IBKR; capturing spreads on the main thread
    lets volume+spread liquidity gates still apply during universe scans.
    """
    if not snapshot:
        return list(bar_quotes)
    merged: List[Quote] = []
    for quote in bar_quotes:
        live = snapshot.get(quote.symbol.upper())
        if live is None:
            merged.append(quote)
            continue
        merged.append(
            Quote(
                symbol=quote.symbol,
                price=quote.price if quote.price is not None else live.price,
                bid=live.bid,
                ask=live.ask,
                spread=live.spread,
                volume=live.volume if live.volume is not None else quote.volume,
            )
        )
    return merged


def backfill_watchlist_symbols(
    settings: Settings,
    bar_store: BarStore,
    ibkr: IBKRClient,
    symbols: Sequence[str],
    *,
    open_symbols: Optional[Sequence[str]] = None,
    on_progress: Optional[Callable[..., None]] = None,
) -> None:
    """Backfill watchlist/core symbols on the main thread (ib_insync needs its event loop)."""
    from market.bars import OPEN_POSITION_INTRADAY_FRESHNESS

    priority = list(dict.fromkeys(s.upper() for s in symbols if s))
    if not priority:
        return
    if settings.data_source != DataSource.IBKR or not ibkr.is_connected():
        return

    stale = set(bar_store.symbols_needing_backfill(priority))
    open_priority = list(dict.fromkeys(s.upper() for s in (open_symbols or []) if s))
    if open_priority:
        stale.update(
            bar_store.symbols_needing_backfill(
                open_priority,
                intraday_max_age=OPEN_POSITION_INTRADAY_FRESHNESS,
            )
        )
    stale_list = [symbol for symbol in priority if symbol in stale]
    # Include open symbols that may not already be in priority.
    for symbol in open_priority:
        if symbol in stale and symbol not in stale_list:
            stale_list.append(symbol)

    if not stale_list:
        logger.info(
            "Watchlist bar cache fresh — skipping backfill (%s symbols)",
            len(priority),
        )
        return

    logger.info(
        "Starting paced watchlist bar backfill for %s/%s symbol(s)",
        len(stale_list),
        len(priority),
    )
    summary = bar_store.backfill_universe(
        stale_list,
        ibkr,
        pacing_sec=settings.bar_backfill_pacing_sec,
        on_progress=on_progress,
    )
    logger.info(
        "Watchlist bar backfill complete — refreshed %s/%s symbol(s)",
        summary.refreshed,
        len(stale_list),
    )
    if summary.unqualified_symbols:
        logger.warning(
            "Unqualified during watchlist backfill: %s",
            ", ".join(summary.unqualified_symbols),
        )


@dataclass
class ScreenerResult:
    watchlist: List[str]
    rankings: List[JevRankedSymbol]
    screener_ran_at: Optional[datetime]


@dataclass
class ScreenerJobContext:
    settings: Settings
    risk_settings: RiskSettings
    db: SupabaseRepository
    jev: JevClient
    minute_bars: MinuteBarStore
    bar_store: BarStore
    mock: MockMarketProvider
    ibkr: IBKRClient
    open_symbols: List[str]
    strategy_config: StrategyConfig
    news_service: Optional[NewsService]
    get_quotes: Callable[[list[str]], List[Quote]]
    # Main-thread IBKR/mock quotes captured at schedule time (for spread/liquidity).
    quote_snapshot: Optional[Dict[str, Quote]] = None


class EMWatchlistScheduler:
    """Background EM universe backfill + Jev screener without blocking the eval loop."""

    def __init__(self) -> None:
        self._state_lock = threading.Lock()
        self._screener_thread: Optional[threading.Thread] = None
        self._backfill_thread: Optional[threading.Thread] = None
        self._backfill_done = threading.Event()
        self._backoff_until_mono = 0.0
        self._pending_result: Optional[ScreenerResult] = None

    def start_em_backfill(
        self,
        settings: Settings,
        bar_store: BarStore,
        ibkr: IBKRClient,
        em_universe: Sequence[str],
        *,
        exclude_symbols: Sequence[str] = (),
    ) -> None:
        if settings.data_source != DataSource.IBKR or not ibkr.is_connected():
            self._backfill_done.set()
            return
        if not settings.em_backfill_on_startup:
            self._backfill_done.set()
            return

        excluded = {s.upper() for s in exclude_symbols if s}
        em_symbols = list(
            dict.fromkeys(
                s.upper() for s in em_universe if s and s.upper() not in excluded
            )
        )
        if not em_symbols:
            self._backfill_done.set()
            return

        with self._state_lock:
            if self._backfill_thread and self._backfill_thread.is_alive():
                return

            def _worker() -> None:
                backfill_ibkr: Optional[IBKRClient] = None
                try:
                    backfill_ibkr = _connect_backfill_ibkr(settings)
                    logger.info(
                        "Starting paced EM bar backfill for %s symbol(s)",
                        len(em_symbols),
                    )
                    em_summary = bar_store.backfill_universe(
                        em_symbols,
                        backfill_ibkr,
                        pacing_sec=settings.bar_backfill_pacing_sec,
                    )
                    logger.info(
                        "EM bar backfill complete — refreshed %s/%s symbol(s)",
                        em_summary.refreshed,
                        em_summary.total,
                    )
                    if em_summary.unqualified_symbols:
                        logger.warning(
                            "Unqualified during EM backfill: %s",
                            ", ".join(em_summary.unqualified_symbols),
                        )
                except Exception as exc:
                    logger.exception("EM bar backfill failed: %s", exc)
                finally:
                    if backfill_ibkr is not None and backfill_ibkr.is_connected():
                        try:
                            backfill_ibkr.ib.disconnect()
                        except Exception:
                            pass
                    self._backfill_done.set()

            self._backfill_thread = threading.Thread(
                target=_worker,
                name="em-bar-backfill",
                daemon=True,
            )
            self._backfill_thread.start()

    def take_completed_screener_result(self) -> Optional[ScreenerResult]:
        with self._state_lock:
            result = self._pending_result
            self._pending_result = None
            return result

    def mark_backfill_unavailable(self) -> None:
        """Signal that startup backfill will not run (skip cache gate waiting)."""
        self._backfill_done.set()

    def maybe_start_screener(self, job: ScreenerJobContext) -> None:
        if not job.risk_settings.watchlist_dynamic_enabled:
            return
        if time.monotonic() < self._backoff_until_mono:
            return
        if not screener_due(job.risk_settings):
            return
        if (
            job.settings.data_source == DataSource.IBKR
            and not is_us_regular_session_open()
        ):
            return

        with self._state_lock:
            if self._screener_thread and self._screener_thread.is_alive():
                return
            self._screener_thread = threading.Thread(
                target=self._run_screener,
                args=(job,),
                name="jev-universe-screener",
                daemon=True,
            )
            self._screener_thread.start()

    def _cache_ready(
        self,
        job: ScreenerJobContext,
        universe: Sequence[str],
    ) -> bool:
        if job.settings.data_source == DataSource.MOCK:
            return True
        coverage = job.bar_store.intraday_coverage(
            universe,
            min_bars=MIN_INTRADAY_BARS,
        )
        if coverage >= CACHE_COVERAGE_RATIO:
            return True
        if self._backfill_done.is_set() and coverage >= MIN_SCORED_RATIO:
            logger.info(
                "Bar cache partially ready (%.0f%%) after backfill — allowing scan",
                coverage * 100,
            )
            return True
        logger.info(
            "Deferring Jev universe scan — intraday cache %.0f%% ready (need %.0f%%)",
            coverage * 100,
            CACHE_COVERAGE_RATIO * 100,
        )
        return False

    def _publish_screener_result(self, job: ScreenerJobContext, result: ScreenerResult) -> None:
        apply_screener_result_to_risk_settings(
            job.risk_settings,
            watchlist=result.watchlist,
            rankings=result.rankings,
            screener_ran_at=result.screener_ran_at,
        )
        with self._state_lock:
            self._pending_result = result

    def _persist_core_fallback(self, job: ScreenerJobContext, reason: str) -> None:
        persisted = merge_core_watchlist(job.risk_settings, [])
        trading = merge_core_watchlist(job.risk_settings, job.open_symbols)
        job.db.update_effective_watchlist_fallback(persisted)
        result = ScreenerResult(
            watchlist=trading,
            rankings=[],
            screener_ran_at=None,
        )
        self._publish_screener_result(job, result)
        logger.warning(
            "Jev scan failed — using always-on core fallback (%s): %s",
            reason,
            ", ".join(trading),
        )

    def _run_screener(self, job: ScreenerJobContext) -> None:
        had_successful_scan = job.risk_settings.watchlist_screener_ran_at is not None

        try:
            universe = load_em_universe(
                db=job.db,
                path=Path(job.settings.resolved_em_universe_path),
            )
        except (FileNotFoundError, ValueError) as exc:
            logger.warning("EM universe unavailable — skipping Jev screener: %s", exc)
            if not had_successful_scan:
                self._persist_core_fallback(job, "universe unavailable")
            self._backoff_until_mono = time.monotonic() + SCREENER_FAILURE_BACKOFF_SEC
            return

        try:
            if not self._cache_ready(job, universe):
                return

            benchmark = effective_benchmark(job.risk_settings)
            scan_symbols = list(dict.fromkeys(universe + [benchmark]))

            if job.settings.data_source == DataSource.MOCK:
                job.mock.ensure_symbols(scan_symbols)
                for symbol in scan_symbols:
                    if job.minute_bars.get(symbol).bar_count() == 0:
                        job.mock.seed_symbol_minute_bars(job.minute_bars, symbol)
                # Mock quotes are thread-safe; IBKR's ib_insync client is not.
                quotes = job.get_quotes(scan_symbols)
            else:
                for symbol in scan_symbols:
                    job.bar_store.seed_minute_aggregator(
                        job.minute_bars.get(symbol),
                        symbol,
                    )
                # Do not call the main IBKR client from this worker thread —
                # cancelMktData/reqMktData need that connection's event loop.
                quotes = merge_quote_liquidity(
                    quotes_from_minute_bars(
                        job.minute_bars,
                        scan_symbols,
                        bar_store=job.bar_store,
                    ),
                    job.quote_snapshot,
                )

            quotes_by_symbol = {quote.symbol: quote for quote in quotes}

            effective, rankings, skips = run_jev_universe_scan(
                risk_settings=job.risk_settings,
                jev=job.jev,
                minute_bars=job.minute_bars,
                bar_store=job.bar_store,
                quotes_by_symbol=quotes_by_symbol,
                open_symbols=job.open_symbols,
                strategy_config=job.strategy_config,
                max_workers=job.settings.jev_max_workers,
                news_service=job.news_service,
                universe_loader=lambda: universe,
            )

            scored_ratio = len(rankings) / max(len(scan_symbols), 1)
            if scored_ratio < MIN_SCORED_RATIO:
                logger.warning(
                    "Jev scan scored too few symbols (%s/%s) (%s)",
                    len(rankings),
                    len(scan_symbols),
                    skips.format(),
                )
                if not had_successful_scan:
                    self._persist_core_fallback(job, "too few scored symbols")
                self._backoff_until_mono = time.monotonic() + SCREENER_FAILURE_BACKOFF_SEC
                return

            dynamic_size = max(0, int(job.risk_settings.watchlist_dynamic_size))
            min_buy = float(getattr(job.risk_settings, "watchlist_min_buy", 0.6) or 0.0)
            dynamic_symbols = top_dynamic_symbols(
                rankings, benchmark, dynamic_size, min_buy=min_buy
            )
            persisted = merge_dynamic_watchlist(job.risk_settings, dynamic_symbols, [])
            ran_at = datetime.now(timezone.utc)
            job.db.update_effective_watchlist(persisted, rankings)
            result = ScreenerResult(
                watchlist=effective,
                rankings=rankings,
                screener_ran_at=ran_at,
            )
            self._publish_screener_result(job, result)

            logger.info(
                "Jev universe scan persisted — effective watchlist: %s",
                ", ".join(persisted),
            )
        except Exception as exc:
            logger.exception("Jev universe screener failed: %s", exc)
            if not had_successful_scan:
                self._persist_core_fallback(job, str(exc))
            self._backoff_until_mono = time.monotonic() + SCREENER_FAILURE_BACKOFF_SEC
