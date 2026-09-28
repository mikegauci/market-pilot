from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from models.types import (
    ClosedTrade,
    JevPrediction,
    MarketState,
    Quote,
    RiskSettings,
    SimulatedPortfolio,
    TradeDecision,
    TradeRecord,
    TradingMode,
)

logger = logging.getLogger(__name__)


class RiskManager:
    """Simulated trade risk engine — no broker orders."""

    def __init__(
        self,
        settings: RiskSettings,
        trading_mode: TradingMode,
        effective_capital: float,
        open_trades: Optional[List[TradeRecord]] = None,
        daily_realized_pnl: float = 0.0,
        total_realized_pnl: float = 0.0,
        currency: str = "USD",
    ) -> None:
        self.settings = settings
        self.trading_mode = trading_mode
        self.effective_capital = effective_capital
        self.currency = currency
        self.open_trades: List[TradeRecord] = list(open_trades or [])
        self.daily_realized_pnl = daily_realized_pnl
        self.total_realized_pnl = total_realized_pnl

    def update_capital(self, effective_capital: float, currency: str = "USD") -> None:
        self.effective_capital = effective_capital
        self.currency = currency

    def update_settings(self, settings: RiskSettings) -> None:
        self.settings = settings

    def reload_open_trades(self, open_trades: List[TradeRecord]) -> None:
        self.open_trades = list(open_trades)

    def set_daily_realized_pnl(self, daily_pnl: float) -> None:
        self.daily_realized_pnl = daily_pnl

    def _deployed_capital(self) -> float:
        return sum(t.position_value for t in self.open_trades)

    def _available_cash(self) -> float:
        return self.effective_capital + self.total_realized_pnl - self._deployed_capital()

    def _unrealized_pnl(self, quotes: Dict[str, Quote]) -> float:
        total = 0.0
        for trade in self.open_trades:
            quote = quotes.get(trade.symbol)
            if quote is None or quote.price is None:
                continue
            total += (quote.price - trade.entry_price) * trade.quantity
        return total

    def _daily_pnl(self, quotes: Dict[str, Quote]) -> float:
        return self.daily_realized_pnl + self._unrealized_pnl(quotes)

    def compute_position_size(self, price: float) -> Optional[tuple[float, float]]:
        """Return (quantity, position_value) or None if size is too small."""
        if price <= 0:
            return None

        stop_pct = self.settings.stop_loss_percentage
        if stop_pct <= 0:
            return None

        risk_based = self.settings.risk_per_trade / stop_pct
        position_value = min(self.settings.max_position_size, risk_based)
        quantity = math.floor(position_value / price)
        if quantity < 1:
            return None

        actual_value = quantity * price
        return quantity, actual_value

    def evaluate_entry(
        self,
        state: MarketState,
        prediction: JevPrediction,
        bot_enabled: bool,
        quotes_by_symbol: Dict[str, Quote],
    ) -> TradeDecision:
        if not bot_enabled:
            return TradeDecision(False, "bot_disabled")

        if state.price <= 0:
            return TradeDecision(False, "invalid_price")

        if any(t.symbol == state.symbol for t in self.open_trades):
            return TradeDecision(False, "already_open")

        if len(self.open_trades) >= self.settings.max_open_positions:
            return TradeDecision(False, "max_open_positions")

        sizing = self.compute_position_size(state.price)
        if sizing is None:
            return TradeDecision(False, "position_too_small")

        quantity, position_value = sizing

        if position_value > self._available_cash():
            return TradeDecision(False, "insufficient_capital")

        if self._daily_pnl(quotes_by_symbol) <= -self.settings.max_daily_loss:
            return TradeDecision(False, "max_daily_loss")

        entry_price = state.price
        stop_loss = round(entry_price * (1 - self.settings.stop_loss_percentage), 6)
        take_profit = round(entry_price * (1 + self.settings.take_profit_percentage), 6)
        now = datetime.now(timezone.utc)

        trade = TradeRecord(
            id=str(uuid.uuid4()),
            symbol=state.symbol,
            side="buy",
            entry_time=now,
            entry_price=entry_price,
            quantity=quantity,
            position_value=position_value,
            stop_loss=stop_loss,
            take_profit=take_profit,
            status="open",
            paper_or_live=self.trading_mode.value,
            jev_buy_probability=prediction.buy,
        )
        return TradeDecision(True, "approved", trade=trade)

    def register_open_trade(self, trade: TradeRecord) -> None:
        self.open_trades.append(trade)

    def remove_open_trade(self, trade_id: str) -> None:
        self.open_trades = [t for t in self.open_trades if t.id != trade_id]

    def record_closed_pnl(self, net_pnl: float) -> None:
        self.daily_realized_pnl += net_pnl
        self.total_realized_pnl += net_pnl

    def check_exits(self, quotes_by_symbol: Dict[str, Quote]) -> List[ClosedTrade]:
        closed: List[ClosedTrade] = []
        remaining: List[TradeRecord] = []

        for trade in self.open_trades:
            if (
                trade.execution_mode == "ibkr"
                and trade.ibkr_sl_order_id
                and trade.ibkr_tp_order_id
            ):
                remaining.append(trade)
                continue

            quote = quotes_by_symbol.get(trade.symbol)
            if quote is None or quote.price is None:
                remaining.append(trade)
                continue

            price = quote.price
            exit_price: Optional[float] = None
            reason = ""

            if price <= trade.stop_loss:
                exit_price = trade.stop_loss
                reason = "stop_loss"
            elif price >= trade.take_profit:
                exit_price = trade.take_profit
                reason = "take_profit"

            if exit_price is None:
                remaining.append(trade)
                continue

            gross_pnl = (exit_price - trade.entry_price) * trade.quantity
            net_pnl = gross_pnl  # no commission/slippage in Phase 3
            now = datetime.now(timezone.utc)

            closed.append(
                ClosedTrade(
                    trade_id=trade.id,
                    symbol=trade.symbol,
                    exit_price=exit_price,
                    exit_time=now,
                    gross_pnl=gross_pnl,
                    net_pnl=net_pnl,
                    reason=reason,
                )
            )
            self.daily_realized_pnl += net_pnl
            self.total_realized_pnl += net_pnl
            logger.info(
                "Simulated exit %s @ $%.2f (%s) PnL $%.2f",
                trade.symbol,
                exit_price,
                reason,
                net_pnl,
            )

        self.open_trades = remaining
        return closed

    def get_portfolio_snapshot(self, quotes_by_symbol: Dict[str, Quote]) -> SimulatedPortfolio:
        unrealized = self._unrealized_pnl(quotes_by_symbol)
        equity = self.effective_capital + self.total_realized_pnl + unrealized
        cash = self._available_cash()
        daily_pnl = self.daily_realized_pnl + unrealized

        return SimulatedPortfolio(
            balance=cash,
            equity=equity,
            daily_pnl=daily_pnl,
            total_pnl=self.total_realized_pnl + unrealized,
            currency=self.currency,
        )
