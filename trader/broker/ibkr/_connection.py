from __future__ import annotations

import logging
import threading
from typing import Dict, List, Optional
from ib_insync import IB, Stock

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
from models.types import AccountSummary, Position

logger = logging.getLogger(__name__)


class IBKRConnectionMixin:
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
            if ticker is not None and ticker_price(ticker) is not None:
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

    @ibkr_synchronized
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

    @ibkr_synchronized
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

    @ibkr_synchronized
    def get_account_summary(self) -> AccountSummary:
        account = self._sync_session_account()
        values = {item.tag: item for item in self.ib.accountValues(account)}

        def value(tag: str, default: float = 0.0) -> float:
            item = values.get(tag)
            if item is None:
                return default
            parsed = safe_float(item.value)
            return parsed if parsed is not None else default

        def optional_value(tag: str) -> Optional[float]:
            item = values.get(tag)
            if item is None:
                return None
            return safe_float(item.value)

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
            ibkr_accrued_cash=optional_value("AccruedCash"),
        )

    @ibkr_synchronized
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
                market_price = ticker_price(ticker)
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

    @ibkr_synchronized
    def get_long_quantity(self, symbol: str) -> float:
        """Whole long shares held at IBKR for this symbol (0 when flat or short)."""
        for position in self.get_positions():
            if position.symbol == symbol and position.quantity > 0:
                return float(position.quantity)
        return 0.0

