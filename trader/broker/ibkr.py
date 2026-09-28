from __future__ import annotations

import logging
import math
from typing import Dict, List, Optional, Tuple

from ib_insync import IB, LimitOrder, MarketOrder, Stock, StopOrder, Trade

from models.types import AccountSummary, BracketLegs, BracketOrderResult, Position, Quote

logger = logging.getLogger(__name__)

TERMINAL_ORDER_STATUSES = frozenset({"Filled", "Cancelled", "Inactive", "ApiCancelled"})


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


def _describe_trade_state(trade: Trade) -> str:
    order_status = trade.orderStatus
    parts = [
        f"status={order_status.status}",
        f"filled={order_status.filled}",
        f"remaining={order_status.remaining}",
    ]
    why_held = getattr(order_status, "whyHeld", None)
    if why_held:
        parts.append(f"whyHeld={why_held!r}")
    for entry in reversed(trade.log):
        if entry.errorCode:
            message = entry.message.strip() or "(no message)"
            parts.append(f"IB {entry.errorCode}: {message}")
            break
    return ", ".join(parts)


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

    def _is_client_id_conflict(self, exc: BaseException) -> bool:
        message = str(exc).lower()
        return (
            "326" in message
            or "client id" in message
            or "clientid" in message
            or "already in use" in message
            or "may be in use" in message
        )

    def _connect_once(self, client_id: int, timeout: float) -> None:
        if self.is_connected():
            self.ib.disconnect()
        self.client_id = client_id
        logger.info(
            "Connecting to IBKR at %s:%s (clientId=%s)",
            self.host,
            self.port,
            self.client_id,
        )
        self.ib.connect(self.host, self.port, clientId=self.client_id, timeout=timeout)
        # Error 326 can arrive right after connect; wait briefly and verify.
        self.ib.sleep(0.5)
        if not self.is_connected():
            raise RuntimeError(
                f"IBKR disconnected immediately (clientId={self.client_id} may be in use)"
            )

    def connect(
        self,
        timeout: float = 10.0,
        same_id_retries: int = 3,
        same_id_retry_delay_sec: float = 2.0,
        fallback_client_ids: int = 2,
    ) -> None:
        if self.is_connected():
            return

        base_client_id = self.client_id
        last_exc: Optional[BaseException] = None

        for attempt in range(1, same_id_retries + 1):
            try:
                self._connect_once(base_client_id, timeout)
                break
            except Exception as exc:
                last_exc = exc
                if self.is_connected():
                    self.ib.disconnect()
                if attempt < same_id_retries and self._is_client_id_conflict(exc):
                    logger.warning(
                        "Client ID %s busy (attempt %s/%s) — retrying in %.0fs "
                        "(IB Gateway may still be releasing a stale session)",
                        base_client_id,
                        attempt,
                        same_id_retries,
                        same_id_retry_delay_sec,
                    )
                    self.ib.sleep(same_id_retry_delay_sec)
                    continue
                if not self._is_client_id_conflict(exc):
                    raise
        else:
            for offset in range(1, fallback_client_ids + 1):
                candidate_id = base_client_id + offset
                logger.warning(
                    "Client ID %s still unavailable — trying fallback clientId=%s "
                    "(another IBKR API client may be connected)",
                    base_client_id,
                    candidate_id,
                )
                try:
                    self._connect_once(candidate_id, timeout)
                    break
                except Exception as exc:
                    last_exc = exc
                    if self.is_connected():
                        self.ib.disconnect()
                    if offset == fallback_client_ids or not self._is_client_id_conflict(exc):
                        raise RuntimeError(
                            f"Could not connect to IBKR — client ID {base_client_id} is busy and "
                            f"fallback IDs {base_client_id + 1}–{candidate_id} also failed. "
                            "Restart IB Gateway or stop other API clients."
                        ) from exc
            else:
                raise RuntimeError(
                    f"Could not connect to IBKR on client ID {base_client_id}."
                ) from last_exc

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

    def sync_watchlist_subscriptions(self, symbols: List[str]) -> None:
        """Subscribe to new symbols and cancel market data for removed ones."""
        target = set(symbols)
        for symbol in list(self._tickers):
            if symbol in target:
                continue
            ticker = self._tickers.pop(symbol)
            if self.is_connected():
                self.ib.cancelMktData(ticker.contract)
            self._contracts.pop(symbol, None)
            logger.debug("Unsubscribed from market data for %s", symbol)
        self.subscribe_watchlist(symbols)

    def get_quotes(self, symbols: List[str], wait_sec: float = 2.0) -> List[Quote]:
        self.sync_watchlist_subscriptions(symbols)
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

    def has_pending_entry_order(self, symbol: str) -> bool:
        """True when an unfilled BUY order is already open for this symbol."""
        if not self.is_connected():
            return False
        self.ib.reqOpenOrders()
        self.ib.sleep(0.2)
        for trade in self.ib.openTrades():
            contract = trade.contract
            if getattr(contract, "symbol", None) != symbol:
                continue
            if trade.order.action != "BUY":
                continue
            if trade.orderStatus.status not in TERMINAL_ORDER_STATUSES:
                return True
        return False

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
        parent.tif = "DAY"
        parent.outsideRth = False

        take_profit_order = LimitOrder("SELL", qty, round(take_profit, 2))
        take_profit_order.account = account
        take_profit_order.orderId = self.ib.client.getReqId()
        take_profit_order.parentId = parent.orderId
        take_profit_order.transmit = False
        take_profit_order.tif = "DAY"
        take_profit_order.outsideRth = False

        stop_loss_order = StopOrder("SELL", qty, round(stop_loss, 2))
        stop_loss_order.account = account
        stop_loss_order.orderId = self.ib.client.getReqId()
        stop_loss_order.parentId = parent.orderId
        stop_loss_order.transmit = True
        stop_loss_order.tif = "DAY"
        stop_loss_order.outsideRth = False

        parent_trade = self.ib.placeOrder(contract, parent)
        tp_trade = self.ib.placeOrder(contract, take_profit_order)
        sl_trade = self.ib.placeOrder(contract, stop_loss_order)

        fill = self._wait_for_fill(parent_trade, fill_timeout_sec, symbol)
        if fill is None:
            status = parent_trade.orderStatus.status
            detail = _describe_trade_state(parent_trade)
            self._cancel_trade(parent_trade)
            self._cancel_trade(tp_trade)
            self._cancel_trade(sl_trade)
            if status in {"Cancelled", "Inactive", "ApiCancelled"}:
                raise RuntimeError(
                    f"Parent order for {symbol} was {status.lower()} before fill ({detail})"
                )
            raise RuntimeError(
                f"Parent order for {symbol} did not fill within {fill_timeout_sec}s ({detail})"
            )

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
        symbol: str = "",
    ) -> Optional[Tuple[float, float]]:
        elapsed = 0.0
        step = 0.5
        last_logged_filled = 0.0
        target_qty = _safe_float(trade.order.totalQuantity) or 0.0
        label = symbol or getattr(trade.contract, "symbol", "order")

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

            filled = _safe_float(trade.orderStatus.filled) or 0.0
            if filled > last_logged_filled:
                logger.info(
                    "%s fill progress: %.0f / %.0f shares (%.0fs)",
                    label,
                    filled,
                    target_qty,
                    elapsed,
                )
                last_logged_filled = filled

        filled = _safe_float(trade.orderStatus.filled) or 0.0
        avg = _safe_float(trade.orderStatus.avgFillPrice)
        if filled >= 1 and avg is not None:
            logger.warning(
                "%s partial fill accepted after %.0fs timeout: %.0f / %.0f shares @ $%.2f",
                label,
                timeout_sec,
                filled,
                target_qty,
                avg,
            )
            return avg, filled
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

    def find_open_bracket_legs(self, symbol: str) -> Optional[BracketLegs]:
        """Find active bracket stop-loss and take-profit orders for a long position."""
        if not self.is_connected():
            return None

        self.ib.reqOpenOrders()
        self.ib.sleep(0.3)

        stop_trade: Optional[Trade] = None
        limit_trade: Optional[Trade] = None

        for trade in self.ib.openTrades():
            contract = trade.contract
            if getattr(contract, "symbol", None) != symbol:
                continue
            order = trade.order
            if order.action != "SELL":
                continue

            order_type = (order.orderType or "").upper()
            if order_type in {"STP", "STOP"} or isinstance(order, StopOrder):
                stop_trade = trade
            elif order_type in {"LMT", "LIMIT"} or isinstance(order, LimitOrder):
                if getattr(order, "parentId", 0):
                    limit_trade = trade

        if stop_trade is None or limit_trade is None:
            return None

        stop_order = stop_trade.order
        limit_order = limit_trade.order
        stop_price = _safe_float(
            getattr(stop_order, "auxPrice", None) or getattr(stop_order, "stopPrice", None)
        )
        tp_price = _safe_float(getattr(limit_order, "lmtPrice", None))
        if stop_price is None or tp_price is None:
            return None

        parent_id = getattr(stop_order, "parentId", None) or getattr(limit_order, "parentId", None)
        return BracketLegs(
            parent_order_id=parent_id if parent_id else None,
            sl_order_id=stop_order.orderId,
            tp_order_id=limit_order.orderId,
            stop_loss=stop_price,
            take_profit=tp_price,
        )

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

    def close_long_position(
        self,
        symbol: str,
        quantity: float,
        *,
        parent_order_id: Optional[int] = None,
        sl_order_id: Optional[int] = None,
        tp_order_id: Optional[int] = None,
        fill_timeout_sec: float = 30.0,
    ) -> Tuple[float, float]:
        """Cancel bracket legs (if any) and market-sell to close a long position."""
        if quantity < 1:
            raise ValueError(f"Invalid quantity for {symbol}: {quantity}")

        if sl_order_id and tp_order_id:
            self.cancel_open_brackets(
                parent_order_id or 0,
                sl_order_id,
                tp_order_id,
            )
            self.ib.sleep(0.3)

        account = self._resolve_account()
        contract = self._ensure_contract(symbol)
        qty = int(quantity)

        sell = MarketOrder("SELL", qty)
        sell.account = account
        sell.orderId = self.ib.client.getReqId()
        sell.tif = "DAY"
        sell.outsideRth = False

        sell_trade = self.ib.placeOrder(contract, sell)
        fill = self._wait_for_fill(sell_trade, fill_timeout_sec, symbol)
        if fill is None:
            status = sell_trade.orderStatus.status
            detail = _describe_trade_state(sell_trade)
            self._cancel_trade(sell_trade)
            raise RuntimeError(
                f"Market SELL for {symbol} did not fill within {fill_timeout_sec}s "
                f"({status}, {detail})"
            )

        fill_price, filled_qty = fill
        logger.info(
            "IBKR market SELL %s x %s @ $%.2f",
            symbol,
            filled_qty,
            fill_price,
        )
        return fill_price, filled_qty
