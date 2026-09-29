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


@dataclass
class BotControl:
    enabled: bool
    trading_mode: TradingMode
    execution_mode: ExecutionMode


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
    news_sentiment: Optional[float] = None
    news_headline_count: Optional[int] = None
    news_top_headline: Optional[str] = None
    news_tags: Optional[List[str]] = None
    news_fetched_at: Optional[str] = None
    news_articles: Optional[List[Dict[str, Any]]] = None

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
class JevRankedSymbol:
    symbol: str
    buy: float
    hold: float
    sell: float
    rank: int


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
    watchlist_core: List[str] = field(default_factory=list)
    watchlist_dynamic_enabled: bool = True
    watchlist_dynamic_size: int = 5
    watchlist_refresh_minutes: int = 30
    benchmark_symbol: str = "EEM"
    watchlist_jev_rankings: List[JevRankedSymbol] = field(default_factory=list)
    watchlist_screener_ran_at: Optional[datetime] = None
    min_volume_ratio: float = 0.0
    demotion_exits_enabled: bool = True
    demotion_max_hold_ratio: float = 0.5
    demotion_jev_sell_on_loss: bool = True
    demotion_jev_sell_max_loss_pct: float = 0.02
    demotion_force_exit: bool = False


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


@dataclass
class BracketOrderResult:
    parent_order_id: int
    sl_order_id: int
    tp_order_id: int
    fill_price: float
    filled_quantity: float


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
