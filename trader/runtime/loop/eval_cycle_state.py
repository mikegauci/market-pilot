from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple

from models.types import ExecutionMode, JevPrediction, Quote, RiskSettings, TradingMode
from strategy.config import StrategyConfig

if TYPE_CHECKING:
    from market.indicators import MarketState
    from runtime.loop.eval_cycle import EvalCycleContext


@dataclass
class EvalCycleScratch:
    """Mutable locals for one eval cycle (synced back to EvalCycleContext at end)."""

    bot_enabled: bool
    trading_mode: TradingMode
    configured_execution_mode: ExecutionMode
    execution_mode: ExecutionMode
    last_bot_control_sync: float
    last_settings_sync: float
    last_heartbeat: float
    last_portfolio_history: float
    last_live_bar_flush: float
    active_ibkr_account_id: Optional[str]
    jev_connected: bool
    risk_settings: RiskSettings
    strategy_config: StrategyConfig
    watchlist: List[str]
    all_symbols: List[str]

    jev_connected_this_cycle: bool = False
    market_open: bool = True
    portfolio_dirty: bool = False
    open_symbols: List[str] = field(default_factory=list)
    benchmark_symbol: str = ""
    benchmark_minute_bars: Any = None
    benchmark_intraday_bars: Any = None
    daily_pnl_account_id: Optional[str] = None
    quotes: List[Quote] = field(default_factory=list)
    quotes_by_symbol: Dict[str, Quote] = field(default_factory=dict)
    eval_symbols: List[str] = field(default_factory=list)
    open_symbol_set: Set[str] = field(default_factory=set)
    jev_sell_symbols: Set[str] = field(default_factory=set)
    prediction_rows: List[dict] = field(default_factory=list)
    predictions_by_symbol: Dict[str, JevPrediction] = field(default_factory=dict)
    ready_states: List[Tuple[str, "MarketState"]] = field(default_factory=list)

    @classmethod
    def from_context(cls, ctx: "EvalCycleContext") -> "EvalCycleScratch":
        return cls(
            bot_enabled=ctx.bot_enabled,
            trading_mode=ctx.trading_mode,
            configured_execution_mode=ctx.configured_execution_mode,
            execution_mode=ctx.execution_mode,
            last_bot_control_sync=ctx.last_bot_control_sync,
            last_settings_sync=ctx.last_settings_sync,
            last_heartbeat=ctx.last_heartbeat,
            last_portfolio_history=ctx.last_portfolio_history,
            last_live_bar_flush=ctx.last_live_bar_flush,
            active_ibkr_account_id=ctx.active_ibkr_account_id,
            jev_connected=ctx.jev_connected,
            risk_settings=ctx.risk_settings,
            strategy_config=ctx.strategy_config,
            watchlist=list(ctx.watchlist),
            all_symbols=list(ctx.all_symbols),
        )

    def apply_to_context(self, ctx: "EvalCycleContext") -> None:
        ctx.bot_enabled = self.bot_enabled
        ctx.trading_mode = self.trading_mode
        ctx.configured_execution_mode = self.configured_execution_mode
        ctx.execution_mode = self.execution_mode
        ctx.last_bot_control_sync = self.last_bot_control_sync
        ctx.last_settings_sync = self.last_settings_sync
        ctx.last_heartbeat = self.last_heartbeat
        ctx.last_portfolio_history = self.last_portfolio_history
        ctx.last_live_bar_flush = self.last_live_bar_flush
        ctx.active_ibkr_account_id = self.active_ibkr_account_id
        ctx.jev_connected = self.jev_connected
        ctx.risk_settings = self.risk_settings
        ctx.strategy_config = self.strategy_config
        ctx.watchlist = self.watchlist
        ctx.all_symbols = self.all_symbols
