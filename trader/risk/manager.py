from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional

from watchlist.demotion import (
    is_demoted_symbol,
    jev_sell_exit_allowed,
    min_hold_remaining_minutes,
    price_between_entry_and_take_profit,
)

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
from risk.sizing import compute_position_sizing, paper_available_cash

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
        self._last_exit_at: Dict[str, datetime] = {}

    def update_capital(self, effective_capital: float, currency: str = "USD") -> None:
        self.effective_capital = effective_capital
        self.currency = currency

    def update_settings(self, settings: RiskSettings) -> None:
        self.settings = settings

    def reload_open_trades(self, open_trades: List[TradeRecord]) -> None:
        self.open_trades = list(open_trades)

    def set_daily_realized_pnl(self, daily_pnl: float) -> None:
        self.daily_realized_pnl = daily_pnl

    def hydrate_reentry_cooldowns(self, exits_by_symbol: Dict[str, datetime]) -> None:
        """Seed per-symbol exit timestamps (e.g. from DB on startup)."""
        for symbol, exit_time in exits_by_symbol.items():
            key = str(symbol).upper()
            if not key or exit_time is None:
                continue
            stamped = exit_time
            if stamped.tzinfo is None:
                stamped = stamped.replace(tzinfo=timezone.utc)
            prior = self._last_exit_at.get(key)
            if prior is None or stamped > prior:
                self._last_exit_at[key] = stamped

    def note_symbol_exit(
        self,
        symbol: str,
        exit_time: Optional[datetime] = None,
    ) -> None:
        key = str(symbol).upper()
        if not key:
            return
        stamped = exit_time or datetime.now(timezone.utc)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=timezone.utc)
        prior = self._last_exit_at.get(key)
        if prior is None or stamped > prior:
            self._last_exit_at[key] = stamped

    def reentry_cooldown_remaining_minutes(
        self,
        symbol: str,
        *,
        now: Optional[datetime] = None,
    ) -> float:
        cooldown = float(getattr(self.settings, "reentry_cooldown_minutes", 0) or 0)
        if cooldown <= 0:
            return 0.0
        last_exit = self._last_exit_at.get(str(symbol).upper())
        if last_exit is None:
            return 0.0
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        elapsed = (current - last_exit).total_seconds() / 60.0
        return max(0.0, cooldown - elapsed)

    def _deployed_capital(self) -> float:
        return sum(t.position_value for t in self.open_trades)

    def _available_cash(self) -> float:
        """Cash available for a new entry.

        Paper: account_capital - deployed notional (ignore IBKR paper cash / NetLiq).
        Live: sizing_capital (min NetLiq, account_capital) + realized - deployed.
        """
        deployed = self._deployed_capital()
        if self.trading_mode == TradingMode.PAPER:
            return paper_available_cash(
                account_capital=self.settings.account_capital,
                deployed_notional=deployed,
            )
        return self.effective_capital + self.total_realized_pnl - deployed

    def _unrealized_pnl(self, quotes: Dict[str, Quote]) -> float:
        from risk.daily_pnl import unrealized_pnl

        return unrealized_pnl(self.open_trades, quotes)

    def _daily_pnl(self, quotes: Dict[str, Quote]) -> float:
        from risk.daily_pnl import compute_daily_loss_pnl

        return compute_daily_loss_pnl(
            realized_pnl=self.daily_realized_pnl,
            open_trades=self.open_trades,
            quotes=quotes,
            risk_settings=self.settings,
        )

    def compute_position_size(self, price: float):
        """Return (quantity, position_value) or None if size is too small."""
        result = compute_position_sizing(
            price=price,
            risk_per_trade=self.settings.risk_per_trade,
            stop_loss_percentage=self.settings.stop_loss_percentage,
            max_position_size=self.settings.max_position_size,
            available_cash=self._available_cash(),
            portfolio_slots_full=False,
        )
        if not result.ok:
            return None
        return result.quantity, result.position_value

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

        reentry_remaining = self.reentry_cooldown_remaining_minutes(state.symbol)
        if reentry_remaining > 0:
            return TradeDecision(
                False,
                f"reentry_cooldown ({reentry_remaining:.0f}m left)",
            )

        slots_full = len(self.open_trades) >= self.settings.max_open_positions
        sizing = compute_position_sizing(
            price=state.price,
            risk_per_trade=self.settings.risk_per_trade,
            stop_loss_percentage=self.settings.stop_loss_percentage,
            max_position_size=self.settings.max_position_size,
            available_cash=self._available_cash(),
            portfolio_slots_full=slots_full,
        )
        if sizing.sizing_binding == "portfolio":
            return TradeDecision(False, "max_open_positions")
        if sizing.sizing_binding == "too_small":
            logger.info(
                "Sizing skip %s: shares<1 binding=%s requested_risk=%.2f",
                state.symbol,
                sizing.sizing_binding,
                sizing.requested_risk_usd,
            )
            return TradeDecision(False, "position_too_small")
        if sizing.sizing_binding == "invalid" or not sizing.ok:
            return TradeDecision(False, "position_too_small")
        if sizing.sizing_binding == "cash":
            # Still may have qty if partial cash; only reject when qty < 1 (handled above)
            # or when cash cannot fund even 1 share — already too_small.
            pass
        if sizing.position_value > self._available_cash() + 1e-6:
            return TradeDecision(False, "insufficient_capital")

        if self._daily_pnl(quotes_by_symbol) <= -self.settings.max_daily_loss:
            return TradeDecision(False, "max_daily_loss")

        # Sticky risk halt (hydrated / set by RiskHaltCoordinator) checked by caller
        # via entry_block; keep evaluate_entry PnL gate for live breach.

        logger.info(
            "Sizing %s: qty=%s value=%.2f requested_risk=%.2f planned_risk=%.2f binding=%s",
            state.symbol,
            sizing.quantity,
            sizing.position_value,
            sizing.requested_risk_usd,
            sizing.planned_risk_usd,
            sizing.sizing_binding,
        )

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
            quantity=float(sizing.quantity),
            position_value=sizing.position_value,
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

    def check_exits(
        self,
        quotes_by_symbol: Dict[str, Quote],
        *,
        max_hold_for_symbol: Optional[Callable[[str], float]] = None,
        max_hold_minutes: Optional[float] = None,
    ) -> List[ClosedTrade]:
        closed: List[ClosedTrade] = []
        remaining: List[TradeRecord] = []

        for trade in self.open_trades:
            # IBKR trades exit only when bracket SL/TP legs fill (sync_ibkr_exits).
            # Orphans reconciled without live bracket orders must not simulate-close.
            if trade.execution_mode == "ibkr":
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
            else:
                hold_minutes = (
                    max_hold_for_symbol(trade.symbol)
                    if max_hold_for_symbol is not None
                    else (max_hold_minutes or 0.0)
                )
                if hold_minutes > 0:
                    hold_limit = trade.entry_time + timedelta(minutes=hold_minutes)
                    if datetime.now(timezone.utc) >= hold_limit:
                        exit_price = price
                        reason = "time_exit"

            if exit_price is None:
                remaining.append(trade)
                continue

            closed.append(self._build_closed_trade(trade, exit_price, reason))

        self.open_trades = remaining
        return closed

    def check_demotion_exits(
        self,
        quotes_by_symbol: Dict[str, Quote],
    ) -> List[ClosedTrade]:
        """Market-close simulated trades when demotion force-exit is enabled."""
        if not self.settings.demotion_exits_enabled or not self.settings.demotion_force_exit:
            return []

        closed: List[ClosedTrade] = []
        closed_ids: set[str] = set()

        for trade in self.open_trades:
            if trade.execution_mode == "ibkr":
                continue
            if not is_demoted_symbol(trade.symbol, self.settings):
                continue

            quote = quotes_by_symbol.get(trade.symbol)
            if quote is None or quote.price is None:
                continue

            closed.append(self._build_closed_trade(trade, quote.price, "demotion_exit"))
            closed_ids.add(trade.id)

        if closed_ids:
            self.open_trades = [t for t in self.open_trades if t.id not in closed_ids]
        return closed

    def can_jev_sell_exit(
        self,
        symbol: str,
        quotes_by_symbol: Dict[str, Quote],
        *,
        log_skip: bool = False,
    ) -> bool:
        """True when a Jev SELL may close an open trade (skip while unrealized PnL is negative)."""
        trade = next((t for t in self.open_trades if t.symbol == symbol), None)
        if trade is None:
            return False

        quote = quotes_by_symbol.get(symbol)
        if quote is None or quote.price is None:
            return False

        if jev_sell_exit_allowed(trade, self.settings, quote):
            return True

        remaining = min_hold_remaining_minutes(trade, self.settings)
        if log_skip and remaining > 0:
            logger.info(
                "Filter: skipping Jev SELL exit for %s — min hold (%.1fm left)",
                symbol,
                remaining,
            )
            return False

        if log_skip and price_between_entry_and_take_profit(trade, quote.price):
            logger.info(
                "Filter: skipping Jev SELL exit for %s — below take profit "
                "($%.2f < TP $%.2f); letting bracket work",
                symbol,
                quote.price,
                trade.take_profit,
            )
            return False

        pnl = (quote.price - trade.entry_price) * trade.quantity
        if log_skip and pnl < 0:
            logger.info(
                "Filter: skipping Jev SELL exit for %s — unrealized loss ($%.2f)",
                symbol,
                pnl,
            )
        return False

    def check_jev_exit(
        self,
        symbol: str,
        quotes_by_symbol: Dict[str, Quote],
    ) -> Optional[ClosedTrade]:
        """Simulated exit at market when Jev SELL signal triggers (IBKR handled separately)."""
        if not self.can_jev_sell_exit(symbol, quotes_by_symbol):
            return None

        trade = next((t for t in self.open_trades if t.symbol == symbol), None)
        if trade is None or trade.execution_mode == "ibkr":
            return None

        quote = quotes_by_symbol.get(symbol)
        if quote is None or quote.price is None:
            return None

        closed = self._build_closed_trade(trade, quote.price, "jev_sell")
        self.open_trades = [t for t in self.open_trades if t.id != trade.id]
        return closed

    def _build_closed_trade(
        self,
        trade: TradeRecord,
        exit_price: float,
        reason: str,
    ) -> ClosedTrade:
        gross_pnl = (exit_price - trade.entry_price) * trade.quantity
        net_pnl = gross_pnl
        now = datetime.now(timezone.utc)

        self.daily_realized_pnl += net_pnl
        self.total_realized_pnl += net_pnl
        logger.info(
            "Simulated exit %s @ $%.2f (%s) PnL $%.2f",
            trade.symbol,
            exit_price,
            reason,
            net_pnl,
        )
        return ClosedTrade(
            trade_id=trade.id,
            symbol=trade.symbol,
            exit_price=exit_price,
            exit_time=now,
            gross_pnl=gross_pnl,
            net_pnl=net_pnl,
            reason=reason,
        )

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
