from __future__ import annotations

from dataclasses import asdict, dataclass
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
    execution_mode: ExecutionMode = ExecutionMode.SIMULATED
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
    change_1m: Optional[float]
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

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


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
    account_capital: float
    watchlist: List[str]


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
    execution_mode: str = "simulated"
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


@dataclass
class SimulatedPortfolio:
    balance: float
    equity: float
    daily_pnl: float
    total_pnl: float
    currency: str = "USD"
