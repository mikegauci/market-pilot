from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List, Optional, Sequence

from broker.ibkr import IBKRClient
from config import Settings
from database.supabase import SupabaseRepository
from jev.client import JevClient
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_us_regular_session_open
from market.mock import MockMarketProvider
from models.types import DataSource, Quote, RiskSettings
from news.client import NewsService
from strategy.config import StrategyConfig
from watchlist.jev_screener import (
    effective_benchmark,
    run_jev_universe_scan,
    screener_due,
)
from watchlist.universe import load_em_universe

logger = logging.getLogger(__name__)

SCREENER_FAILURE_BACKOFF_SEC = 300.0
MIN_SCORED_RATIO = 0.25
CACHE_COVERAGE_RATIO = 0.70
MIN_INTRADAY_BARS = 30


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


class EMWatchlistScheduler:
    """Background EM universe backfill + Jev screener without blocking the eval loop."""

    def __init__(self) -> None:
        self._state_lock = threading.Lock()
        self._screener_thread: Optional[threading.Thread] = None
        self._backfill_thread: Optional[threading.Thread] = None
        self._backfill_done = threading.Event()
        self._backoff_until_mono = 0.0
        self._pending_watchlist: Optional[List[str]] = None

    def start_backfill(
        self,
        settings: Settings,
        bar_store: BarStore,
        ibkr: IBKRClient,
        universe: Sequence[str],
    ) -> None:
        if not settings.em_backfill_on_startup:
            self._backfill_done.set()
            return
        if settings.data_source != DataSource.IBKR or not ibkr.is_connected():
            self._backfill_done.set()
            return

        with self._state_lock:
            if self._backfill_thread and self._backfill_thread.is_alive():
                return

            def _worker() -> None:
                try:
                    logger.info(
                        "Starting paced EM bar backfill for %s symbols",
                        len(universe),
                    )
                    summary = bar_store.backfill_universe(
                        list(universe),
                        ibkr,
                        pacing_sec=settings.bar_backfill_pacing_sec,
                    )
                    logger.info(
                        "EM bar backfill complete — refreshed %s/%s symbol(s)",
                        summary.refreshed,
                        summary.total,
                    )
                    if summary.unqualified_symbols:
                        logger.warning(
                            "Unqualified during backfill: %s",
                            ", ".join(summary.unqualified_symbols),
                        )
                finally:
                    self._backfill_done.set()

            self._backfill_thread = threading.Thread(
                target=_worker,
                name="em-bar-backfill",
                daemon=True,
            )
            self._backfill_thread.start()

    def take_completed_watchlist(self) -> Optional[List[str]]:
        with self._state_lock:
            watchlist = self._pending_watchlist
            self._pending_watchlist = None
            return watchlist

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

    def _run_screener(self, job: ScreenerJobContext) -> None:
        try:
            universe = load_em_universe(
                db=job.db,
                path=Path(job.settings.resolved_em_universe_path),
            )
        except (FileNotFoundError, ValueError) as exc:
            logger.warning("EM universe unavailable — skipping Jev screener: %s", exc)
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
            else:
                for symbol in scan_symbols:
                    job.bar_store.seed_minute_aggregator(
                        job.minute_bars.get(symbol),
                        symbol,
                    )

            quotes = job.get_quotes(scan_symbols)
            quotes_by_symbol = {quote.symbol: quote for quote in quotes}
            for quote in quotes:
                job.minute_bars.record(quote)

            effective, rankings = run_jev_universe_scan(
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
                    "Jev scan scored too few symbols (%s/%s) — will retry later",
                    len(rankings),
                    len(scan_symbols),
                )
                return

            job.db.update_effective_watchlist(effective, rankings)
            job.risk_settings.watchlist = effective
            job.risk_settings.watchlist_jev_rankings = rankings
            job.risk_settings.watchlist_screener_ran_at = datetime.now(timezone.utc)

            with self._state_lock:
                self._pending_watchlist = effective

            logger.info(
                "Jev universe scan persisted — effective watchlist: %s",
                ", ".join(effective),
            )
        except Exception as exc:
            logger.exception("Jev universe screener failed: %s", exc)
            self._backoff_until_mono = time.monotonic() + SCREENER_FAILURE_BACKOFF_SEC
