from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

from config import Settings
from database.supabase import SupabaseRepository
from market.bar_aggregator import MinuteBarStore
from market.bars import BarStore
from market.hours import is_entry_window_open, is_us_regular_session_open
from market.mock import MockMarketProvider
from models.types import DataSource
from risk.manager import RiskManager
from runtime.loop.eval_cycle_state import EvalCycleScratch
from runtime.state import TraderRuntimeState
from runtime.timing import should_refresh
from runtime.trader_ops import merge_watchlist_symbols, sync_watchlist_symbols
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker
from watchlist.backfill import backfill_watchlist_symbols
from watchlist.breakout_runtime import maybe_promote_breakouts
from watchlist.resolution import effective_benchmark, resolve_rotation_scan_watchlist
from watchlist.rotation_runtime import maybe_rotate_watchlist

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient


def run_cycle_rotation_and_bar_flush(
    *,
    db: SupabaseRepository | None,
    settings: Settings,
    mock: MockMarketProvider,
    minute_bars: MinuteBarStore,
    bar_store: BarStore,
    ibkr: "IBKRClient",
    risk_manager: RiskManager | None,
    confirmation_tracker: ConfirmationTracker,
    strategy_config: StrategyConfig,
    scratch: EvalCycleScratch,
    runtime: TraderRuntimeState,
) -> None:
    if (
        db
        and scratch.risk_settings.watchlist_rotation_enabled
        and scratch.risk_settings.watchlist_pool
    ):
        benchmark_agg = (
            minute_bars.get(scratch.benchmark_symbol)
            if scratch.benchmark_symbol
            else None
        )
        rotation_kwargs = dict(
            db=db,
            minute_bars=minute_bars,
            bar_store=bar_store,
            quotes_by_symbol=scratch.quotes_by_symbol,
            benchmark_minute_bars=benchmark_agg,
            confirmation_tracker=confirmation_tracker,
            open_symbols=scratch.open_symbols,
            runtime=runtime,
            now_mono=time.monotonic(),
            market_open=scratch.market_open
            if settings.data_source != DataSource.IBKR
            else is_us_regular_session_open(),
            strategy_config=strategy_config,
        )
        scratch.risk_settings, breakout_swapped_in = maybe_promote_breakouts(
            risk_settings=scratch.risk_settings,
            # No point promoting a name the bot is no longer allowed to enter.
            entry_window_open=(
                settings.data_source != DataSource.IBKR
                or is_entry_window_open(
                    cutoff_minutes_before_close=(
                        strategy_config.entry_cutoff_minutes_before_close
                    )
                )
            ),
            **rotation_kwargs,
        )
        scratch.risk_settings, rotation_swapped_in = maybe_rotate_watchlist(
            risk_settings=scratch.risk_settings,
            **rotation_kwargs,
        )
        rotation_swapped_in = list(
            dict.fromkeys([*breakout_swapped_in, *rotation_swapped_in])
        )
        scratch.watchlist = resolve_rotation_scan_watchlist(scratch.risk_settings)
        if rotation_swapped_in:
            rot_open = (
                [t.symbol for t in risk_manager.open_trades] if risk_manager else []
            )
            rot_benchmark = effective_benchmark(scratch.risk_settings)
            rot_quote_symbols = list(
                dict.fromkeys(
                    list(scratch.risk_settings.watchlist_pool)
                    + scratch.watchlist
                    + rot_open
                )
            )
            rot_all_symbols = merge_watchlist_symbols(rot_quote_symbols, rot_benchmark)
            new_rot_symbols = sync_watchlist_symbols(
                rot_all_symbols,
                mock,
                minute_bars,
                bar_store,
                settings.data_source,
                runtime,
            )
            if settings.data_source == DataSource.IBKR and ibkr.is_connected():
                ibkr.sync_watchlist_subscriptions(rot_all_symbols)
                if new_rot_symbols:
                    backfill_watchlist_symbols(
                        settings,
                        bar_store,
                        ibkr,
                        new_rot_symbols,
                        open_symbols=rot_open,
                    )

    now_mono = time.monotonic()
    if (
        risk_manager
        and (
            settings.data_source == DataSource.MOCK
            or is_us_regular_session_open()
        )
        and should_refresh(
            now_mono,
            scratch.last_live_bar_flush,
            settings.live_bar_flush_interval_sec,
        )
    ):
        flush_symbols = list(
            dict.fromkeys(
                [*scratch.all_symbols, *(trade.symbol for trade in risk_manager.open_trades)]
            )
        )
        if flush_symbols:
            flushed = bar_store.flush_live_intraday_bars(flush_symbols, minute_bars)
            if flushed:
                logger.debug("Flushed live 5m bars for %s symbol(s)", flushed)
        scratch.last_live_bar_flush = now_mono
