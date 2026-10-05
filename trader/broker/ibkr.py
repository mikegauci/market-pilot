from __future__ import annotations

import asyncio
import logging
import math
import threading
from datetime import datetime, timezone
from functools import wraps
from typing import Callable, Dict, List, Optional, Tuple, TypeVar

F = TypeVar("F", bound=Callable[..., object])


def _ibkr_synchronized(method: F) -> F:
    @wraps(method)
    def wrapper(self: "IBKRClient", *args: object, **kwargs: object) -> object:
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper  # type: ignore[return-value]

from ib_insync import IB, LimitOrder, MarketOrder, Stock, StopOrder, Trade

from broker.symbols import from_ibkr_contract, to_ibkr_symbol
from market.bars import BAR_SIZE_DAILY, BAR_SIZE_INTRADAY, Bar
from models.types import (
    AccountSummary,
    BracketLegs,
    BracketOrderResult,
    OrderFill,
    Position,
    Quote,
)

logger = logging.getLogger(__name__)

TERMINAL_ORDER_STATUSES = frozenset({"Filled", "Cancelled", "Inactive", "ApiCancelled"})
MARKET_DATA_COMPETING_SESSION_CODE = 10197
MARKET_DATA_TYPE_DELAYED = 3
MARKET_DATA_MIN_COVERAGE_RATIO = 0.5

MARKET_DATA_COMPETING_SESSION_MSG = (
    "IBKR error 10197 — another session (TWS, IB Gateway, or IBKR mobile) is using "
    "live market data for this account. Close other IB clients and restart Gateway, "
    "or the trader will use snapshot/delayed quotes when available."
)


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


def _commission_from_trade(trade: Trade) -> float:
    total = 0.0
    for fill in trade.fills or []:
        report = getattr(fill, "commissionReport", None)
        if report is None:
            continue
        commission = _safe_float(getattr(report, "commission", None))
        if commission is not None:
            total += abs(commission)
    return round(total, 4)


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


# Permanent account/product eligibility failures — retrying will not help.
_ELIGIBILITY_REJECTION_MARKERS = (
    "no trading permission",
    "customer ineligible",
    "ineligibility reasons",
    "does not have a kid",
    "appropriate kid is available",
)

# Stronger product-document signals for IBKR eligibility rejections.
_KID_REJECTION_MARKERS = (
    "does not have a kid",
    "appropriate kid is available",
    "ineligibility reasons",
)


def is_permanent_ibkr_eligibility_rejection(detail: object) -> bool:
    """True when IB rejected the order for product/account eligibility (e.g. missing KID)."""
    text = str(detail or "").lower()
    if not text:
        return False
    return any(marker in text for marker in _ELIGIBILITY_REJECTION_MARKERS)


def is_kid_document_rejection(detail: object) -> bool:
    """True when rejection cites missing/unavailable KID (durable product ineligibility)."""
    text = str(detail or "").lower()
    if not text:
        return False
    return any(marker in text for marker in _KID_REJECTION_MARKERS)


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
        self.account = account.strip() if account else ""
        self._preferred_account = self.account
        self.market_data_type = market_data_type
        self.ib = IB()
        self._lock = threading.RLock()
        self._contracts: Dict[str, Stock] = {}
        self._tickers: Dict[str, object] = {}
        self._market_data_blocked = False
        self._use_snapshot_quotes = False
        self._error_handler_registered = False

    def is_connected(self) -> bool:
        return self.ib.isConnected()

    def market_data_is_blocked(self) -> bool:
        return self._market_data_blocked

    def market_data_mode(self) -> str:
        if self._use_snapshot_quotes:
            return "snapshot"
        return "stream"

    def _on_ib_error(
        self,
        req_id: int,
        error_code: int,
        error_string: str,
        contract: object,
    ) -> None:
        del req_id, contract
        if error_code == MARKET_DATA_COMPETING_SESSION_CODE:
            self._market_data_blocked = True
            logger.debug("IBKR %s: %s", error_code, error_string)

    def _ensure_error_handler(self) -> None:
        if self._error_handler_registered:
            return
        self.ib.errorEvent += self._on_ib_error
        self._error_handler_registered = True

    def _count_priced_symbols(self, symbols: List[str]) -> Tuple[int, int]:
        priced = 0
        for symbol in symbols:
            ticker = self._tickers.get(symbol)
            if ticker is not None and _ticker_price(ticker) is not None:
                priced += 1
        return priced, len(symbols)

    def _cancel_all_market_data(self) -> None:
        for symbol in list(self._tickers):
            ticker = self._tickers.pop(symbol)
            if self.is_connected():
                self.ib.cancelMktData(ticker.contract)
        self._contracts.clear()

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
        # Avoid blocking startup for ~60s when IBKR cancels slow historical requests.
        self.ib.RequestTimeout = 25
        # Error 326 can arrive right after connect; wait briefly and verify.
        self.ib.sleep(0.5)
        if not self.is_connected():
            raise RuntimeError(
                f"IBKR disconnected immediately (clientId={self.client_id} may be in use)"
            )

    @_ibkr_synchronized
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

        self._ensure_error_handler()

        # 1=live, 2=frozen, 3=delayed, 4=delayed frozen — paper accounts use delayed.
        self.ib.reqMarketDataType(self.market_data_type)
        logger.info("IBKR market data type: %s", self.market_data_type)
        if self.is_connected():
            self._sync_session_account()
        logger.info("Connected to IBKR")

    @_ibkr_synchronized
    def disconnect(self) -> None:
        if self.is_connected():
            self.ib.disconnect()
            logger.info("Disconnected from IBKR")

    def _sync_session_account(self) -> str:
        """Bind to IBKR_ACCOUNT when set, else the Gateway/TWS login session account."""
        if not self.is_connected():
            if self._preferred_account:
                return self._preferred_account
            raise RuntimeError("IBKR is not connected")

        managed = list(self.ib.managedAccounts())
        if not managed:
            raise RuntimeError("No IBKR managed accounts available")

        if self._preferred_account:
            if self._preferred_account not in managed:
                logger.warning(
                    "IBKR_ACCOUNT %s not in session managed accounts %s — using pinned id",
                    self._preferred_account,
                    managed,
                )
            if self.account != self._preferred_account:
                logger.info("Using IBKR account: %s (pinned)", self._preferred_account)
            self.account = self._preferred_account
            return self.account

        if self.account and self.account in managed:
            session_account = self.account
        else:
            session_account = managed[0]
        if len(managed) > 1:
            logger.debug(
                "Multiple IBKR managed accounts %s — using %s for this session",
                managed,
                session_account,
            )
        if self.account and self.account != session_account:
            logger.info(
                "IBKR session account changed: %s -> %s",
                self.account,
                session_account,
            )
        elif not self.account:
            logger.info("Using IBKR account: %s (session)", session_account)
        self.account = session_account
        return self.account

    def _resolve_account(self) -> str:
        return self._sync_session_account()

    @_ibkr_synchronized
    def get_account_summary(self) -> AccountSummary:
        account = self._sync_session_account()
        values = {item.tag: item for item in self.ib.accountValues(account)}

        def value(tag: str, default: float = 0.0) -> float:
            item = values.get(tag)
            if item is None:
                return default
            parsed = _safe_float(item.value)
            return parsed if parsed is not None else default

        def optional_value(tag: str) -> Optional[float]:
            item = values.get(tag)
            if item is None:
                return None
            return _safe_float(item.value)

        currency = "USD"
        net_liq_item = values.get("NetLiquidation")
        if net_liq_item and net_liq_item.currency:
            currency = net_liq_item.currency

        unrealized = value("UnrealizedPnL")
        realized = value("RealizedPnL")

        return AccountSummary(
            account_id=account,
            net_liquidation=value("NetLiquidation"),
            total_cash=value("TotalCashValue"),
            buying_power=value("BuyingPower"),
            currency=currency,
            ibkr_daily_pnl=optional_value("DailyPnL"),
            unrealized_pnl=unrealized,
            realized_pnl=realized,
        )

    @_ibkr_synchronized
    def get_positions(self) -> List[Position]:
        account = self._resolve_account()
        result: List[Position] = []

        for pos in self.ib.positions(account):
            contract = pos.contract
            if not hasattr(contract, "symbol"):
                continue
            symbol = self._resolve_app_symbol(contract)
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

    def _resolve_app_symbol(self, contract: object) -> str:
        con_id = getattr(contract, "conId", None)
        if con_id:
            for app_symbol, cached in self._contracts.items():
                if cached.conId == con_id:
                    return app_symbol

        ib_symbol = getattr(contract, "symbol", "") or ""
        local_symbol = getattr(contract, "localSymbol", "") or ""
        app_symbol = from_ibkr_contract(ib_symbol, local_symbol)
        for candidate in (app_symbol, ib_symbol):
            if candidate in self._contracts:
                return candidate
        return app_symbol

    def _contract_matches_symbol(self, contract: object, symbol: str) -> bool:
        cached = self._contracts.get(symbol)
        if cached is not None and getattr(contract, "conId", None) == cached.conId:
            return True
        return self._resolve_app_symbol(contract) == symbol

    def _ensure_contract(self, symbol: str) -> Stock:
        contract = self._try_ensure_contract(symbol)
        if contract is None:
            raise RuntimeError(f"Could not qualify contract for {symbol}")
        return contract

    @_ibkr_synchronized
    def _try_ensure_contract(self, symbol: str) -> Optional[Stock]:
        symbol = symbol.upper()
        if symbol in self._contracts:
            return self._contracts[symbol]
        contract = Stock(to_ibkr_symbol(symbol), "SMART", "USD")
        qualified = self.ib.qualifyContracts(contract)
        if not qualified:
            return None
        self._contracts[symbol] = qualified[0]
        return self._contracts[symbol]

    @_ibkr_synchronized
    def can_trade_symbol(self, symbol: str) -> bool:
        """Return True when symbol qualifies as SMART/USD on IBKR."""
        return self._try_ensure_contract(symbol) is not None

    @_ibkr_synchronized
    def subscribe_watchlist(self, symbols: List[str]) -> None:
        if self._use_snapshot_quotes:
            return
        for symbol in symbols:
            if symbol in self._tickers:
                continue
            try:
                contract = self._ensure_contract(symbol)
            except RuntimeError:
                logger.warning("Skipping market data for %s — contract could not be qualified", symbol)
                continue
            ticker = self.ib.reqMktData(contract, "", False, False)
            self._tickers[symbol] = ticker
            logger.debug("Subscribed to market data for %s", symbol)

    @_ibkr_synchronized
    def _try_recover_streaming_market_data(self, symbols: List[str], wait_sec: float) -> bool:
        if self.market_data_type != MARKET_DATA_TYPE_DELAYED:
            logger.warning(
                "Retrying IBKR market data as delayed (type %s → %s)",
                self.market_data_type,
                MARKET_DATA_TYPE_DELAYED,
            )
            self.market_data_type = MARKET_DATA_TYPE_DELAYED
            self.ib.reqMarketDataType(MARKET_DATA_TYPE_DELAYED)

        self._market_data_blocked = False
        self._cancel_all_market_data()
        self.subscribe_watchlist(symbols)
        if wait_sec > 0:
            self.ib.sleep(wait_sec)
        priced, total = self._count_priced_symbols(symbols)
        if total and priced / total >= MARKET_DATA_MIN_COVERAGE_RATIO:
            logger.info(
                "IBKR streaming market data recovered — %s/%s symbols priced",
                priced,
                total,
            )
            return True
        return False

    @_ibkr_synchronized
    def _enable_snapshot_quotes(self) -> None:
        if self._use_snapshot_quotes:
            return
        self._use_snapshot_quotes = True
        self._cancel_all_market_data()
        logger.warning(
            "Streaming market data unavailable — falling back to IBKR snapshot quotes "
            "(one request per symbol per cycle; close competing IB sessions to restore streaming)"
        )

    @_ibkr_synchronized
    def _get_snapshot_quotes(self, symbols: List[str], wait_sec: float) -> List[Quote]:
        per_symbol_wait = wait_sec / max(len(symbols), 1)
        per_symbol_wait = min(max(per_symbol_wait, 0.2), 1.0)
        quotes: List[Quote] = []
        for symbol in symbols:
            contract = self._try_ensure_contract(symbol)
            if contract is None:
                quotes.append(
                    Quote(symbol=symbol, price=None, bid=None, ask=None, spread=None)
                )
                continue
            ticker = self.ib.reqMktData(contract, "", True, False)
            self.ib.sleep(per_symbol_wait)
            price = _ticker_price(ticker)
            bid = _safe_float(getattr(ticker, "bid", None))
            ask = _safe_float(getattr(ticker, "ask", None))
            spread = None
            if bid is not None and ask is not None and ask >= bid:
                spread = round(ask - bid, 6)
            if self.is_connected():
                self.ib.cancelMktData(contract)
            quotes.append(
                Quote(
                    symbol=symbol,
                    price=price,
                    bid=bid,
                    ask=ask,
                    spread=spread,
                    volume=None,
                )
            )
        return quotes

    @_ibkr_synchronized
    def ensure_market_data_ready(self, symbols: List[str], wait_sec: float = 2.0) -> str:
        """Verify streaming quotes; recover or fall back to snapshots when blocked.

        Returns one of: ``stream``, ``snapshot``, ``unavailable``.
        """
        if not self.is_connected() or not symbols:
            return "unavailable"

        self._market_data_blocked = False
        self._use_snapshot_quotes = False
        self.subscribe_watchlist(symbols)
        if wait_sec > 0:
            self.ib.sleep(wait_sec)

        priced, total = self._count_priced_symbols(symbols)
        if total and priced / total >= MARKET_DATA_MIN_COVERAGE_RATIO:
            return "stream"

        if self._market_data_blocked or priced == 0:
            logger.warning(MARKET_DATA_COMPETING_SESSION_MSG)
            if self._try_recover_streaming_market_data(symbols, wait_sec):
                return "stream"

        self._enable_snapshot_quotes()
        snapshot_quotes = self._get_snapshot_quotes(symbols, wait_sec=wait_sec)
        snapshot_priced = sum(1 for quote in snapshot_quotes if quote.price is not None)
        if total and snapshot_priced / total >= MARKET_DATA_MIN_COVERAGE_RATIO:
            logger.info(
                "IBKR snapshot quotes active — %s/%s symbols priced",
                snapshot_priced,
                total,
            )
            return "snapshot"

        logger.error(
            "IBKR market data unavailable for %s/%s symbols after recovery attempts. "
            "Heartbeats continue but Jev/signals need prices — close TWS, IBKR mobile, "
            "and other API clients, then restart IB Gateway.",
            snapshot_priced,
            total,
        )
        return "unavailable"

    @_ibkr_synchronized
    def sync_watchlist_subscriptions(self, symbols: List[str]) -> None:
        """Subscribe to new symbols and cancel market data for removed ones."""
        if self._use_snapshot_quotes:
            return
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

    @_ibkr_synchronized
    def get_quotes(self, symbols: List[str], wait_sec: float = 2.0) -> List[Quote]:
        if self._use_snapshot_quotes:
            return self._get_snapshot_quotes(symbols, wait_sec)

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

    @_ibkr_synchronized
    def has_pending_entry_order(self, symbol: str) -> bool:
        """True when an unfilled BUY order is already open for this symbol."""
        if not self.is_connected():
            return False
        self.ib.reqOpenOrders()
        self.ib.sleep(0.2)
        for trade in self.ib.openTrades():
            contract = trade.contract
            if not self._contract_matches_symbol(contract, symbol):
                continue
            if trade.order.action != "BUY":
                continue
            if trade.orderStatus.status not in TERMINAL_ORDER_STATUSES:
                return True
        return False

    @_ibkr_synchronized
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

        filled_qty = int(fill.quantity)
        if filled_qty < 1:
            raise RuntimeError(f"Invalid fill quantity for {symbol}: {fill.quantity}")
        if filled_qty != qty:
            self._sync_bracket_child_quantities(
                contract,
                parent_trade,
                sl_trade,
                tp_trade,
                filled_qty,
                requested_qty=qty,
                symbol=symbol,
            )

        logger.info(
            "IBKR bracket BUY %s x %s @ $%.2f (commission $%.2f; parent=%s sl=%s tp=%s)",
            symbol,
            fill.quantity,
            fill.price,
            fill.commission,
            parent_trade.order.orderId,
            sl_trade.order.orderId,
            tp_trade.order.orderId,
        )

        return BracketOrderResult(
            parent_order_id=parent_trade.order.orderId,
            sl_order_id=sl_trade.order.orderId,
            tp_order_id=tp_trade.order.orderId,
            fill_price=fill.price,
            filled_quantity=fill.quantity,
            entry_commission=fill.commission,
        )

    def _wait_for_fill(
        self,
        trade: Trade,
        timeout_sec: float,
        symbol: str = "",
    ) -> Optional[OrderFill]:
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
                    commission = _commission_from_trade(trade)
                    return OrderFill(price=avg, quantity=filled, commission=commission)
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
            commission = _commission_from_trade(trade)
            return OrderFill(price=avg, quantity=filled, commission=commission)
        return None

    def _sync_bracket_child_quantities(
        self,
        contract: Stock,
        parent_trade: Trade,
        sl_trade: Trade,
        tp_trade: Trade,
        filled_qty: int,
        *,
        requested_qty: int,
        symbol: str,
    ) -> None:
        """Match SL/TP sizes to the filled parent quantity (partial fills)."""
        if parent_trade.orderStatus.status not in TERMINAL_ORDER_STATUSES:
            self._cancel_trade(parent_trade)
        for child_trade in (sl_trade, tp_trade):
            child_qty = int(_safe_float(child_trade.order.totalQuantity) or 0)
            if child_qty == filled_qty:
                continue
            child_trade.order.totalQuantity = filled_qty
            self.ib.placeOrder(contract, child_trade.order)
        logger.info(
            "IBKR bracket %s resized legs to %s shares (requested %s)",
            symbol,
            filled_qty,
            requested_qty,
        )

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

    @_ibkr_synchronized
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
            if not self._contract_matches_symbol(contract, symbol):
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

    @_ibkr_synchronized
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

    @_ibkr_synchronized
    def cancel_open_brackets(self, parent_id: int, sl_id: int, tp_id: int) -> None:
        for order_id in (parent_id, sl_id, tp_id):
            trade = self._find_trade_by_order_id(order_id)
            if trade:
                self._cancel_trade(trade)

    @_ibkr_synchronized
    def close_long_position(
        self,
        symbol: str,
        quantity: float,
        *,
        parent_order_id: Optional[int] = None,
        sl_order_id: Optional[int] = None,
        tp_order_id: Optional[int] = None,
        fill_timeout_sec: float = 30.0,
    ) -> OrderFill:
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

        logger.info(
            "IBKR market SELL %s x %s @ $%.2f (commission $%.2f)",
            symbol,
            fill.quantity,
            fill.price,
            fill.commission,
        )
        return fill

    @_ibkr_synchronized
    def fetch_historical_bars(
        self,
        symbol: str,
        duration: str = "1 W",
        bar_size: str = BAR_SIZE_DAILY,
        use_rth: bool = True,
    ) -> List[Bar]:
        """Fetch OHLCV bars from IBKR for cache seeding."""
        if not self.is_connected():
            return []

        contract = self._try_ensure_contract(symbol)
        if contract is None:
            logger.warning("Skipping historical bars for %s — contract not qualified", symbol)
            return []

        try:
            raw_bars = self.ib.reqHistoricalData(
                contract,
                endDateTime="",
                durationStr=duration,
                barSizeSetting=bar_size,
                whatToShow="TRADES",
                useRTH=use_rth,
                formatDate=1,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Historical bars timed out for %s (%s %s) — will retry on next backfill",
                symbol,
                duration,
                bar_size,
            )
            return []
        result: List[Bar] = []
        app_symbol = symbol.upper()
        for item in raw_bars or []:
            ts = getattr(item, "date", None)
            if ts is None:
                continue
            if isinstance(ts, datetime):
                bar_ts = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
            else:
                try:
                    parsed = datetime.fromisoformat(str(ts).replace(" ", "T"))
                except ValueError:
                    continue
                bar_ts = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

            open_px = _safe_float(getattr(item, "open", None))
            high_px = _safe_float(getattr(item, "high", None))
            low_px = _safe_float(getattr(item, "low", None))
            close_px = _safe_float(getattr(item, "close", None))
            if None in (open_px, high_px, low_px, close_px):
                continue

            volume_raw = getattr(item, "volume", 0)
            try:
                volume = int(volume_raw or 0)
            except (TypeError, ValueError):
                volume = 0

            normalized_size = bar_size
            if bar_size in {"5 min", "5mins", "5 mins"}:
                normalized_size = BAR_SIZE_INTRADAY
            elif bar_size in {"1 day", "1day", "1 day"}:
                normalized_size = BAR_SIZE_DAILY

            result.append(
                Bar(
                    symbol=app_symbol,
                    bar_size=normalized_size,
                    ts=bar_ts,
                    open=open_px,
                    high=high_px,
                    low=low_px,
                    close=close_px,
                    volume=volume,
                )
            )
        return result
