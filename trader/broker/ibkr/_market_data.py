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


class IBKRMarketDataMixin:
    @ibkr_synchronized
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

    @ibkr_synchronized
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

    @ibkr_synchronized
    def _enable_snapshot_quotes(self) -> None:
        if self._use_snapshot_quotes:
            return
        self._use_snapshot_quotes = True
        self._cancel_all_market_data()
        logger.warning(
            "Streaming market data unavailable — falling back to IBKR snapshot quotes "
            "(one request per symbol per cycle; close competing IB sessions to restore streaming)"
        )

    @ibkr_synchronized
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
            price = ticker_price(ticker)
            bid = safe_float(getattr(ticker, "bid", None))
            ask = safe_float(getattr(ticker, "ask", None))
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

    @ibkr_synchronized
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

    @ibkr_synchronized
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

    @ibkr_synchronized
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

            price = ticker_price(ticker)
            bid = safe_float(ticker.bid)
            ask = safe_float(ticker.ask)
            spread = None
            if bid is not None and ask is not None and ask >= bid:
                spread = round(ask - bid, 6)

            volume_parsed = safe_float(ticker.volume)
            volume = int(volume_parsed) if volume_parsed is not None else None

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
