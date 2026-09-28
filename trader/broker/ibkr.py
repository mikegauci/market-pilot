from __future__ import annotations

import logging
import math
from typing import Dict, List, Optional, Tuple

from ib_insync import IB, LimitOrder, MarketOrder, Stock, StopOrder, Trade

from models.types import AccountSummary, BracketOrderResult, Position, Quote

logger = logging.getLogger(__name__)


def _safe_float(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def _ticker_price(ticker: object) -> Optional[float]:
    """Best available price from an IB ticker (live, delayed, or mid)."""
    for attr in ("last", "close", "delayedLast", "marketPrice"):
        if attr == "marketPrice":
            value = getattr(ticker, "marketPrice", lambda: None)()
        else:
            value = getattr(ticker, attr, None)
        parsed = _safe_float(value)
        if parsed is not None and parsed > 0:
            return parsed

    bid = _safe_float(getattr(ticker, "bid", None))
    ask = _safe_float(getattr(ticker, "ask", None))
    if bid is not None and ask is not None and ask >= bid > 0:
        return round((bid + ask) / 2, 6)
    return None


class IBKRClient:
    """Interactive Brokers client for quotes, account data, and order execution."""

    def __init__(
        self,
        host: str,
        port: int,
        client_id: int,
        account: str = "",
        market_data_type: int = 3,
    ) -> None:
        self.host = host
        self.port = port
        self.client_id = client_id
        self.account = account
        self.market_data_type = market_data_type
        self.ib = IB()
        self._contracts: Dict[str, Stock] = {}
        self._tickers: Dict[str, object] = {}

    def is_connected(self) -> bool:
        return self.ib.isConnected()

    def connect(self, timeout: float = 10.0) -> None:
        if self.is_connected():
            return
        logger.info("Connecting to IBKR at %s:%s (clientId=%s)", self.host, self.port, self.client_id)
        self.ib.connect(self.host, self.port, clientId=self.client_id, timeout=timeout)
        # 1=live, 2=frozen, 3=delayed, 4=delayed frozen — paper accounts use delayed.
        self.ib.reqMarketDataType(self.market_data_type)
        logger.info("IBKR market data type: %s", self.market_data_type)
        if not self.account:
            accounts = self.ib.managedAccounts()
            if accounts:
                self.account = accounts[0]
                logger.info("Using IBKR account: %s", self.account)
        logger.info("Connected to IBKR")

    def disconnect(self) -> None:
        if self.is_connected():
            self.ib.disconnect()
            logger.info("Disconnected from IBKR")

    def _resolve_account(self) -> str:
        if self.account:
            return self.account
        accounts = self.ib.managedAccounts()
        if not accounts:
            raise RuntimeError("No IBKR managed accounts available")
        self.account = accounts[0]
        return self.account

    def get_account_summary(self) -> AccountSummary:
        account = self._resolve_account()
        values = {item.tag: item for item in self.ib.accountValues(account)}

        def value(tag: str, default: float = 0.0) -> float:
            item = values.get(tag)
            if item is None:
                return default
            parsed = _safe_float(item.value)
            return parsed if parsed is not None else default

        currency = "USD"
        net_liq_item = values.get("NetLiquidation")
        if net_liq_item and net_liq_item.currency:
            currency = net_liq_item.currency

        return AccountSummary(
            account_id=account,
            net_liquidation=value("NetLiquidation"),
            total_cash=value("TotalCashValue"),
            buying_power=value("BuyingPower"),
            currency=currency,
        )

    def get_positions(self) -> List[Position]:
        account = self._resolve_account()
        result: List[Position] = []

        for pos in self.ib.positions(account):
            contract = pos.contract
            if not hasattr(contract, "symbol"):
                continue
            symbol = contract.symbol
            market_price = None
            market_value = None
            unrealized_pnl = None

            if symbol in self._tickers:
                ticker = self._tickers[symbol]
                market_price = _ticker_price(ticker)
                if market_price is not None:
                    market_value = market_price * pos.position
                    unrealized_pnl = (market_price - pos.avgCost) * pos.position

            result.append(
                Position(
                    symbol=symbol,
                    quantity=float(pos.position),
                    avg_cost=float(pos.avgCost),
                    market_price=market_price,
                    market_value=market_value,
                    unrealized_pnl=unrealized_pnl,
                    currency=getattr(contract, "currency", "USD") or "USD",
                )
            )

        return result

    def _ensure_contract(self, symbol: str) -> Stock:
        if symbol not in self._contracts:
            contract = Stock(symbol, "SMART", "USD")
            qualified = self.ib.qualifyContracts(contract)
            if not qualified:
                raise RuntimeError(f"Could not qualify contract for {symbol}")
            self._contracts[symbol] = qualified[0]
        return self._contracts[symbol]

    def subscribe_watchlist(self, symbols: List[str]) -> None:
        for symbol in symbols:
            if symbol in self._tickers:
                continue
            contract = self._ensure_contract(symbol)
            ticker = self.ib.reqMktData(contract, "", False, False)
            self._tickers[symbol] = ticker
            logger.debug("Subscribed to market data for %s", symbol)

    def get_quotes(self, symbols: List[str], wait_sec: float = 2.0) -> List[Quote]:
        self.subscribe_watchlist(symbols)
        if wait_sec > 0:
            self.ib.sleep(wait_sec)

        quotes: List[Quote] = []
        for symbol in symbols:
            ticker = self._tickers.get(symbol)
            if ticker is None:
                quotes.append(Quote(symbol=symbol, price=None, bid=None, ask=None, spread=None))
                continue

            price = _ticker_price(ticker)
            bid = _safe_float(ticker.bid)
            ask = _safe_float(ticker.ask)
            spread = None
            if bid is not None and ask is not None and ask >= bid:
                spread = round(ask - bid, 6)

            volume_raw = ticker.volume
            volume = int(volume_raw) if volume_raw and not math.isnan(float(volume_raw)) else None

            quotes.append(
                Quote(
                    symbol=symbol,
                    price=price,
                    bid=bid,
                    ask=ask,
                    spread=spread,
                    volume=volume,
                )
            )

        return quotes

    def place_bracket_buy(
        self,
        symbol: str,
        quantity: float,
        stop_loss: float,
        take_profit: float,
        fill_timeout_sec: float = 30.0,
    ) -> BracketOrderResult:
        """Place market buy with bracket stop-loss and take-profit child orders."""
        if quantity < 1:
            raise ValueError(f"Invalid quantity for {symbol}: {quantity}")

        account = self._resolve_account()
        contract = self._ensure_contract(symbol)
        qty = int(quantity)

        parent = MarketOrder("BUY", qty)
        parent.account = account
        parent.orderId = self.ib.client.getReqId()
        parent.transmit = False

        take_profit_order = LimitOrder("SELL", qty, round(take_profit, 2))
        take_profit_order.account = account
        take_profit_order.orderId = self.ib.client.getReqId()
        take_profit_order.parentId = parent.orderId
        take_profit_order.transmit = False

        stop_loss_order = StopOrder("SELL", qty, round(stop_loss, 2))
        stop_loss_order.account = account
        stop_loss_order.orderId = self.ib.client.getReqId()
        stop_loss_order.parentId = parent.orderId
        stop_loss_order.transmit = True

        parent_trade = self.ib.placeOrder(contract, parent)
        tp_trade = self.ib.placeOrder(contract, take_profit_order)
        sl_trade = self.ib.placeOrder(contract, stop_loss_order)

        fill = self._wait_for_fill(parent_trade, fill_timeout_sec)
        if fill is None:
            self._cancel_trade(parent_trade)
            self._cancel_trade(tp_trade)
            self._cancel_trade(sl_trade)
            raise RuntimeError(f"Parent order for {symbol} did not fill within {fill_timeout_sec}s")

        fill_price, filled_qty = fill
        logger.info(
            "IBKR bracket BUY %s x %s @ $%.2f (parent=%s sl=%s tp=%s)",
            symbol,
            filled_qty,
            fill_price,
            parent_trade.order.orderId,
            sl_trade.order.orderId,
            tp_trade.order.orderId,
        )

        return BracketOrderResult(
            parent_order_id=parent_trade.order.orderId,
            sl_order_id=sl_trade.order.orderId,
            tp_order_id=tp_trade.order.orderId,
            fill_price=fill_price,
            filled_quantity=filled_qty,
        )

    def _wait_for_fill(
        self,
        trade: Trade,
        timeout_sec: float,
    ) -> Optional[Tuple[float, float]]:
        elapsed = 0.0
        step = 0.5
        while elapsed < timeout_sec:
            self.ib.sleep(step)
            elapsed += step
            status = trade.orderStatus.status
            if status == "Filled":
                avg = _safe_float(trade.orderStatus.avgFillPrice)
                filled = _safe_float(trade.orderStatus.filled)
                if avg is not None and filled is not None and filled > 0:
                    return avg, filled
            if status in {"Cancelled", "Inactive", "ApiCancelled"}:
                return None
        return None

    def _cancel_trade(self, trade: Trade) -> None:
        if trade.orderStatus.status not in {"Filled", "Cancelled", "Inactive"}:
            self.ib.cancelOrder(trade.order)

    def _find_trade_by_order_id(self, order_id: Optional[int]) -> Optional[Trade]:
        if order_id is None:
            return None
        for trade in self.ib.trades():
            if trade.order.orderId == order_id:
                return trade
        for trade in self.ib.openTrades():
            if trade.order.orderId == order_id:
                return trade
        return None

    def get_bracket_exit_status(
        self,
        parent_order_id: Optional[int],
        sl_order_id: Optional[int],
        tp_order_id: Optional[int],
        entry_price: float,
        quantity: float,
    ) -> Optional[Tuple[float, str]]:
        """Return (exit_price, reason) if SL or TP filled, else None."""
        del parent_order_id, quantity  # reserved for future position-sync checks
        self.ib.reqOpenOrders()
        self.ib.sleep(0.3)

        sl_trade = self._find_trade_by_order_id(sl_order_id)
        if sl_trade and sl_trade.orderStatus.status == "Filled":
            price = _safe_float(sl_trade.orderStatus.avgFillPrice) or entry_price
            return price, "stop_loss"

        tp_trade = self._find_trade_by_order_id(tp_order_id)
        if tp_trade and tp_trade.orderStatus.status == "Filled":
            price = _safe_float(tp_trade.orderStatus.avgFillPrice) or entry_price
            return price, "take_profit"

        return None

    def cancel_open_brackets(self, parent_id: int, sl_id: int, tp_id: int) -> None:
        for order_id in (parent_id, sl_id, tp_id):
            trade = self._find_trade_by_order_id(order_id)
            if trade:
                self._cancel_trade(trade)
