from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class TradingMode(str, Enum):
    PAPER = "paper"
    LIVE = "live"


class DataSource(str, Enum):
    MOCK = "mock"
    IBKR = "ibkr"


class ExecutionMode(str, Enum):
    SIMULATED = "simulated"
    IBKR = "ibkr"


@dataclass
class AccountSummary:
    account_id: str
    net_liquidation: float
    total_cash: float
    buying_power: float
    currency: str = "USD"
    ibkr_daily_pnl: Optional[float] = None
    unrealized_pnl: float = 0.0
    realized_pnl: float = 0.0
    ibkr_accrued_cash: Optional[float] = None


@dataclass
class Position:
    symbol: str
    quantity: float
    avg_cost: float
    market_price: Optional[float]
    market_value: Optional[float]
    unrealized_pnl: Optional[float]
    currency: str = "USD"


@dataclass
class Quote:
    symbol: str
    price: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    spread: Optional[float]
    volume: Optional[int] = None


@dataclass
class BotStatusUpdate:
    enabled: bool
    trading_mode: TradingMode
    ibkr_connected: bool
    jev_connected: bool = False
    execution_mode: ExecutionMode = ExecutionMode.IBKR
    last_error: Optional[str] = None
    ibkr_account_id: Optional[str] = None


@dataclass
class BotControl:
    enabled: bool
    trading_mode: TradingMode
    execution_mode: ExecutionMode
    shutdown_requested: bool = False


@dataclass
class MarketState:
    symbol: str
    price: float
    change_5m: Optional[float]
    change_15m: Optional[float]
    volume_ratio: Optional[float]
    rsi: Optional[float]
    ema_9: Optional[float]
    ema_20: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    spread: Optional[float]
    spy_change_5m: Optional[float]
    change_1d: Optional[float] = None
    change_5d: Optional[float] = None
    change_1w: Optional[float] = None
    benchmark_change_5m: Optional[float] = None
    avg_dollar_volume_5m: Optional[float] = None
    relative_strength_5m: Optional[float] = None
    relative_strength_15m: Optional[float] = None
    news_sentiment: Optional[float] = None
    news_headline_count: Optional[int] = None
    news_top_headline: Optional[str] = None
    news_tags: Optional[List[str]] = None
    news_fetched_at: Optional[str] = None
    news_articles: Optional[List[Dict[str, Any]]] = None
    news_materiality_note: Optional[str] = None
    news_still_relevant_for_open: Optional[bool] = None
    tape_sentiment: Optional[float] = None
    tape_tags: Optional[List[str]] = None
    tape_top_headline: Optional[str] = None
    tape_fetched_at: Optional[str] = None
    ai_shadow_verdict: Optional[str] = None
    ai_shadow_note: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        if payload.get("benchmark_change_5m") is None and payload.get("spy_change_5m") is not None:
            payload["benchmark_change_5m"] = payload["spy_change_5m"]
        return payload


@dataclass
class JevPrediction:
    symbol: str
    buy: float
    hold: float
    sell: float
    timestamp: datetime
    model: str = ""


@dataclass
class StrategySettings:
    minimum_jev_confidence: float
    signal_record_threshold: float
    watchlist: List[str]


@dataclass
class RiskSettings:
    minimum_jev_confidence: float
    signal_record_threshold: float
    risk_per_trade: float
    max_position_size: float
    max_daily_loss: float
    max_open_positions: int
    stop_loss_percentage: float
    take_profit_percentage: float
    max_hold_minutes: float
    account_capital: float
    risk_sync_equity: Optional[float]
    watchlist: List[str]
    benchmark_symbol: str = ""
    min_volume_ratio: float = 0.5
    min_share_price: float = 20.0
    min_dollar_volume: float = 250_000.0
    # Block Jev SELL soft-exits until the trade has been open this many minutes.
    min_hold_minutes: float = 15.0
    # Minimum Jev SELL probability to soft-exit (must also be sell-dominant).
    jev_sell_exit_threshold: float = 0.95
    # Early take-profit when price reaches a band along entry→TP (fractions 0–1).
    profit_take_enabled: bool = False
    profit_take_min_fraction: float = 0.70
    profit_take_max_fraction: float = 0.80
    profit_take_min_band_hits: int = 3
    profit_take_band_window_cycles: int = 10
    profit_take_jev_sell_threshold: float = 0.70
    # Early loss cut when price reaches a band along entry→stop (fractions 0–1).
    loss_cut_enabled: bool = False
    loss_cut_min_fraction: float = 0.70
    loss_cut_max_fraction: float = 0.90
    loss_cut_min_band_hits: int = 3
    loss_cut_band_window_cycles: int = 10
    loss_cut_jev_sell_threshold: float = 0.0
    # Block new entries in a symbol for this many minutes after an exit. 0 = off.
    reentry_cooldown_minutes: float = 45.0
    # Max new entries per symbol per US trading day. 0 = off.
    max_entries_per_symbol_per_day: int = 3
    # Watchlist rotation: min session % vs RTH open. None = off, 0 = require >= 0%.
    rotation_min_session_change_pct: Optional[float] = 0.0
    # When False, rotation floor comes from env StrategyConfig (optional column not loaded).
    rotation_session_pct_from_settings: bool = False
    entry_ema_gate: str = "ema_20"
    entry_ema_gate_from_settings: bool = False
    max_rsi: float = 70.0
    max_rsi_from_settings: bool = False
    max_spread_pct: float = 0.0015
    max_spread_pct_from_settings: bool = False
    confirmation_cycles: int = 2
    confirmation_seconds: float = 30.0
    watchlist_pool: List[str] = field(default_factory=list)
    watchlist_active: List[str] = field(default_factory=list)
    watchlist_rotation_enabled: bool = False
    watchlist_active_size: int = 12
    watchlist_rotation_interval_minutes: int = 15
    watchlist_max_swaps_per_rotation: int = 2
    watchlist_last_rotation_note: str = ""
    # Manual dashboard block: no entries until unblocked or expiry.
    entry_blocked_symbols: List[str] = field(default_factory=list)
    entry_blocked_at: Dict[str, str] = field(default_factory=dict)


@dataclass
class TradeRecord:
    id: str
    symbol: str
    side: str
    entry_time: datetime
    entry_price: float
    quantity: float
    position_value: float
    stop_loss: float
    take_profit: float
    status: str
    paper_or_live: str
    jev_buy_probability: Optional[float] = None
    exit_time: Optional[datetime] = None
    exit_price: Optional[float] = None
    gross_pnl: Optional[float] = None
    net_pnl: Optional[float] = None
    execution_mode: str = "ibkr"
    ibkr_parent_order_id: Optional[int] = None
    ibkr_sl_order_id: Optional[int] = None
    ibkr_tp_order_id: Optional[int] = None
    entry_commission: Optional[float] = None
    exit_commission: Optional[float] = None
    ibkr_account_id: Optional[str] = None


@dataclass(frozen=True)
class OrderFill:
    price: float
    quantity: float
    commission: float = 0.0


@dataclass
class BracketOrderResult:
    parent_order_id: int
    sl_order_id: int
    tp_order_id: int
    fill_price: float
    filled_quantity: float
    entry_commission: float = 0.0


@dataclass
class BracketLegs:
    """Active stop-loss and take-profit child orders for an open long position."""

    parent_order_id: Optional[int]
    sl_order_id: int
    tp_order_id: int
    stop_loss: float
    take_profit: float


@dataclass
class TradeDecision:
    approved: bool
    reason: str
    trade: Optional[TradeRecord] = None


@dataclass
class ClosedTrade:
    trade_id: str
    symbol: str
    exit_price: float
    exit_time: datetime
    gross_pnl: float
    net_pnl: float
    reason: str
    filled_quantity: Optional[float] = None


@dataclass
class SimulatedPortfolio:
    balance: float
    equity: float
    daily_pnl: float
    total_pnl: float
    currency: str = "USD"
