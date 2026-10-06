from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Callable, Dict, List, Optional, TypeVar

import httpx
from supabase import Client, ClientOptions, create_client

from risk.recommendations import should_advance_baseline

from market.bars import BAR_SIZE_DAILY, BAR_SIZE_INTRADAY, Bar
from market.hours import trading_day_start_utc
from strategy.exits import normalize_profit_take_fractions
from models.types import (
    AccountSummary,
    BotControl,
    BotStatusUpdate,
    ExecutionMode,
    JevPrediction,
    MarketState,
    Position,
    Quote,
    RiskSettings,
    SimulatedPortfolio,
    StrategySettings,
    TradeRecord,
    TradingMode,
)
from database.prediction_payload import build_prediction_payload as _build_prediction_payload
from notify.telegram import notify_trade_closed, notify_trade_opened
from database.trade_account_scope import (
    apply_trade_account_filter,
    include_legacy_untagged_trades,
)
from news.market_news import dedupe_market_news_rows

logger = logging.getLogger(__name__)


# Failure backoff so a bad Finnhub/DB cycle does not wait the full refresh interval.
GENERAL_NEWS_FAILURE_BACKOFF_SEC = 60.0

# Transient macOS/httpx failures (EAGAIN / Errno 35) under concurrent load.
_DB_TRANSIENT_RETRIES = 3
_DB_TRANSIENT_BACKOFF_SEC = 0.05

F = TypeVar("F", bound=Callable[..., object])


def _is_transient_db_error(exc: BaseException) -> bool:
    if isinstance(
        exc,
        (
            httpx.ReadError,
            httpx.WriteError,
            httpx.ConnectError,
            httpx.RemoteProtocolError,
            httpx.ReadTimeout,
            httpx.ConnectTimeout,
        ),
    ):
        return True
    message = str(exc).lower()
    return (
        "resource temporarily unavailable" in message
        or "errno 35" in message
        or "connection reset" in message
    )


def _db_synchronized(method: F) -> F:
    """Serialize httpx/PostgREST access — the sync client is not thread-safe."""

    @wraps(method)
    def wrapper(self: "SupabaseRepository", *args: object, **kwargs: object) -> object:
        last_exc: Optional[BaseException] = None
        for attempt in range(1, _DB_TRANSIENT_RETRIES + 1):
            try:
                with self._lock:
                    return method(self, *args, **kwargs)
            except Exception as exc:
                last_exc = exc
                if attempt >= _DB_TRANSIENT_RETRIES or not _is_transient_db_error(exc):
                    raise
                delay = _DB_TRANSIENT_BACKOFF_SEC * (2 ** (attempt - 1))
                logger.warning(
                    "Transient Supabase error on %s (attempt %s/%s): %s — retrying in %.2fs",
                    method.__name__,
                    attempt,
                    _DB_TRANSIENT_RETRIES,
                    exc,
                    delay,
                )
                time.sleep(delay)
        assert last_exc is not None
        raise last_exc

    return wrapper  # type: ignore[return-value]


def _build_supabase_http_client() -> httpx.Client:
    """HTTP/1.1 only — HTTP/2 multiplex + ib_insync often yields Errno 35 on macOS."""
    return httpx.Client(
        http2=False,
        timeout=httpx.Timeout(60.0, connect=15.0),
    )


# Postgres may return variable fractional digits (e.g. .99074); Python 3.9 needs 6.
_ISO_FRACTION = re.compile(r"\.(\d+)([+-])")


def _normalize_iso_timestamp(text: str) -> str:
    text = text.replace("Z", "+00:00")

    def repl(match: re.Match[str]) -> str:
        frac = match.group(1)
        tz_sep = match.group(2)
        return f".{frac[:6]:0<6}{tz_sep}"

    return _ISO_FRACTION.sub(repl, text, count=1)


def _ensure_utc_iso(value: datetime) -> str:
    parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _parse_timestamp(value: object) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = _normalize_iso_timestamp(str(value))
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _trade_from_row(row: dict) -> TradeRecord:
    return TradeRecord(
        id=str(row["id"]),
        symbol=str(row["symbol"]),
        side=str(row["side"]),
        entry_time=_parse_timestamp(row["entry_time"]),
        entry_price=float(row["entry_price"]),
        quantity=float(row["quantity"]),
        position_value=float(row["position_value"]),
        stop_loss=float(row["stop_loss"]),
        take_profit=float(row["take_profit"]),
        status=str(row["status"]),
        paper_or_live=str(row["paper_or_live"]),
        jev_buy_probability=float(row["jev_buy_probability"]) if row.get("jev_buy_probability") is not None else None,
        exit_time=_parse_timestamp(row["exit_time"]) if row.get("exit_time") else None,
        exit_price=float(row["exit_price"]) if row.get("exit_price") is not None else None,
        gross_pnl=float(row["gross_pnl"]) if row.get("gross_pnl") is not None else None,
        net_pnl=float(row["net_pnl"]) if row.get("net_pnl") is not None else None,
        execution_mode=str(row.get("execution_mode", "ibkr")),
        ibkr_parent_order_id=int(row["ibkr_parent_order_id"]) if row.get("ibkr_parent_order_id") is not None else None,
        ibkr_sl_order_id=int(row["ibkr_sl_order_id"]) if row.get("ibkr_sl_order_id") is not None else None,
        ibkr_tp_order_id=int(row["ibkr_tp_order_id"]) if row.get("ibkr_tp_order_id") is not None else None,
        entry_commission=(
            float(row["commission"])
            if row.get("commission") is not None
            else None
        ),
        ibkr_account_id=(
            str(row["ibkr_account_id"])
            if row.get("ibkr_account_id")
            else None
        ),
    )


__all__ = [
    "BAR_SIZE_DAILY",
    "BAR_SIZE_INTRADAY",
    "Bar",
    "BotControl",
    "BotStatusUpdate",
    "Callable",
    "Client",
    "ClientOptions",
    "Dict",
    "ExecutionMode",
    "F",
    "GENERAL_NEWS_FAILURE_BACKOFF_SEC",
    "JevPrediction",
    "List",
    "MarketState",
    "Optional",
    "Position",
    "Quote",
    "RiskSettings",
    "SimulatedPortfolio",
    "StrategySettings",
    "TradeRecord",
    "TradingMode",
    "TypeVar",
    "AccountSummary",
    "_build_prediction_payload",
    "_build_supabase_http_client",
    "_db_synchronized",
    "_ensure_utc_iso",
    "_parse_timestamp",
    "_trade_from_row",
    "apply_trade_account_filter",
    "create_client",
    "datetime",
    "dedupe_market_news_rows",
    "include_legacy_untagged_trades",
    "logger",
    "normalize_profit_take_fractions",
    "notify_trade_closed",
    "notify_trade_opened",
    "should_advance_baseline",
    "threading",
    "time",
    "timedelta",
    "timezone",
    "trading_day_start_utc",
]


