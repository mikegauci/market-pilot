from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from ib_insync import IB, LimitOrder, MarketOrder, Stock, StopOrder, Trade

from broker.ibkr._sync import ibkr_synchronized
from broker.ibkr._util import (
    MARKET_DATA_COMPETING_SESSION_CODE,
    MARKET_DATA_COMPETING_SESSION_MSG,
    MARKET_DATA_MIN_COVERAGE_RATIO,
    MARKET_DATA_TYPE_DELAYED,
    TERMINAL_ORDER_STATUSES,
    commission_from_trade,
    describe_trade_state,
    is_ibkr_request_timeout,
    safe_float,
    ticker_price,
)
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


class IBKROrdersMixin:
    @ibkr_synchronized
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

    @ibkr_synchronized
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
            detail = describe_trade_state(parent_trade)
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
        target_qty = safe_float(trade.order.totalQuantity) or 0.0
        label = symbol or getattr(trade.contract, "symbol", "order")

        while elapsed < timeout_sec:
            self.ib.sleep(step)
            elapsed += step
            status = trade.orderStatus.status
            if status == "Filled":
                avg = safe_float(trade.orderStatus.avgFillPrice)
                filled = safe_float(trade.orderStatus.filled)
                if avg is not None and filled is not None and filled > 0:
                    commission = commission_from_trade(trade)
                    return OrderFill(price=avg, quantity=filled, commission=commission)
            if status in {"Cancelled", "Inactive", "ApiCancelled"}:
                return None

            filled = safe_float(trade.orderStatus.filled) or 0.0
            if filled > last_logged_filled:
                logger.info(
                    "%s fill progress: %.0f / %.0f shares (%.0fs)",
                    label,
                    filled,
                    target_qty,
                    elapsed,
                )
                last_logged_filled = filled

        filled = safe_float(trade.orderStatus.filled) or 0.0
        avg = safe_float(trade.orderStatus.avgFillPrice)
        if filled >= 1 and avg is not None:
            logger.warning(
                "%s partial fill accepted after %.0fs timeout: %.0f / %.0f shares @ $%.2f",
                label,
                timeout_sec,
                filled,
                target_qty,
                avg,
            )
            commission = commission_from_trade(trade)
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
            child_qty = int(safe_float(child_trade.order.totalQuantity) or 0)
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

    @ibkr_synchronized
    def sync_open_orders(self, wait_sec: float = 0.3) -> None:
        """Refresh IB open-order cache once before multiple bracket lookups."""
        if not self.is_connected():
            return
        self.ib.reqOpenOrders()
        if wait_sec > 0:
            self.ib.sleep(wait_sec)

    @ibkr_synchronized
    def find_open_bracket_legs(
        self,
        symbol: str,
        *,
        open_orders_synced: bool = False,
    ) -> Optional[BracketLegs]:
        """Find active bracket stop-loss and take-profit orders for a long position."""
        if not self.is_connected():
            return None

        if not open_orders_synced:
            self.sync_open_orders()

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
        stop_price = safe_float(
            getattr(stop_order, "auxPrice", None) or getattr(stop_order, "stopPrice", None)
        )
        tp_price = safe_float(getattr(limit_order, "lmtPrice", None))
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

    @ibkr_synchronized
    def get_bracket_exit_status(
        self,
        parent_order_id: Optional[int],
        sl_order_id: Optional[int],
        tp_order_id: Optional[int],
        entry_price: float,
        quantity: float,
        *,
        open_orders_synced: bool = False,
    ) -> Optional[Tuple[float, str]]:
        """Return (exit_price, reason) if SL or TP filled, else None."""
        del parent_order_id, quantity  # reserved for future position-sync checks
        if not open_orders_synced:
            self.sync_open_orders()

        sl_trade = self._find_trade_by_order_id(sl_order_id)
        if sl_trade and sl_trade.orderStatus.status == "Filled":
            price = safe_float(sl_trade.orderStatus.avgFillPrice) or entry_price
            return price, "stop_loss"

        tp_trade = self._find_trade_by_order_id(tp_order_id)
        if tp_trade and tp_trade.orderStatus.status == "Filled":
            price = safe_float(tp_trade.orderStatus.avgFillPrice) or entry_price
            return price, "take_profit"

        return None

    @ibkr_synchronized
    def cancel_open_brackets(self, parent_id: int, sl_id: int, tp_id: int) -> None:
        for order_id in (parent_id, sl_id, tp_id):
            trade = self._find_trade_by_order_id(order_id)
            if trade:
                self._cancel_trade(trade)

    @ibkr_synchronized
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

        long_qty = self.get_long_quantity(symbol)
        sell_qty = min(int(quantity), int(long_qty))
        if sell_qty < 1:
            raise RuntimeError("no_long_position")

        if sell_qty < int(quantity):
            logger.warning(
                "IBKR close %s: capping sell from %s to %s (broker long)",
                symbol,
                int(quantity),
                sell_qty,
            )

        account = self._resolve_account()
        contract = self._ensure_contract(symbol)
        qty = sell_qty

        sell = MarketOrder("SELL", qty)
        sell.account = account
        sell.orderId = self.ib.client.getReqId()
        sell.tif = "DAY"
        sell.outsideRth = False

        sell_trade = self.ib.placeOrder(contract, sell)
        fill = self._wait_for_fill(sell_trade, fill_timeout_sec, symbol)
        if fill is None:
            status = sell_trade.orderStatus.status
            detail = describe_trade_state(sell_trade)
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

    @ibkr_synchronized
    def cover_short_position(
        self,
        symbol: str,
        quantity: float,
        *,
        fill_timeout_sec: float = 30.0,
    ) -> OrderFill:
        """Market-buy to cover a short position (untracked broker exposure)."""
        if quantity < 1:
            raise ValueError(f"Invalid cover quantity for {symbol}: {quantity}")

        short_qty = 0.0
        for position in self.get_positions():
            if position.symbol == symbol and position.quantity < 0:
                short_qty = abs(float(position.quantity))
                break
        buy_qty = min(int(quantity), int(short_qty))
        if buy_qty < 1:
            raise RuntimeError("no_short_position")

        if buy_qty < int(quantity):
            logger.warning(
                "IBKR cover %s: capping buy from %s to %s (broker short)",
                symbol,
                int(quantity),
                buy_qty,
            )

        account = self._resolve_account()
        contract = self._ensure_contract(symbol)
        buy = MarketOrder("BUY", buy_qty)
        buy.account = account
        buy.orderId = self.ib.client.getReqId()
        buy.tif = "DAY"
        buy.outsideRth = False

        buy_trade = self.ib.placeOrder(contract, buy)
        fill = self._wait_for_fill(buy_trade, fill_timeout_sec, symbol)
        if fill is None:
            status = buy_trade.orderStatus.status
            detail = describe_trade_state(buy_trade)
            self._cancel_trade(buy_trade)
            raise RuntimeError(
                f"Market BUY cover for {symbol} did not fill within {fill_timeout_sec}s "
                f"({status}, {detail})"
            )

        logger.info(
            "IBKR market BUY cover %s x %s @ $%.2f (commission $%.2f)",
            symbol,
            fill.quantity,
            fill.price,
            fill.commission,
        )
        return fill

    @ibkr_synchronized
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
        except Exception as exc:
            if not is_ibkr_request_timeout(exc):
                raise
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

            open_px = safe_float(getattr(item, "open", None))
            high_px = safe_float(getattr(item, "high", None))
            low_px = safe_float(getattr(item, "low", None))
            close_px = safe_float(getattr(item, "close", None))
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
