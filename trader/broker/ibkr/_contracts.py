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


class IBKRContractsMixin:
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

    @ibkr_synchronized
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

    @ibkr_synchronized
    def can_trade_symbol(self, symbol: str) -> bool:
        """Return True when symbol qualifies as SMART/USD on IBKR."""
        return self._try_ensure_contract(symbol) is not None
