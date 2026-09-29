from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Callable, List, Optional, TypeVar

import httpx
from supabase import Client, ClientOptions, create_client

from risk.recommendations import should_advance_baseline

from market.bars import Bar, BAR_SIZE_DAILY, BAR_SIZE_INTRADAY
from models.types import (
    AccountSummary,
    BotControl,
    BotStatusUpdate,
    ExecutionMode,
    JevPrediction,
    JevRankedSymbol,
    MarketState,
    Position,
    Quote,
    RiskSettings,
    SimulatedPortfolio,
    StrategySettings,
    TradeRecord,
    TradingMode,
)
from news.market_news import dedupe_market_news_rows

logger = logging.getLogger(__name__)

MAX_EM_UNIVERSE_SIZE = 80

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
    )


class SupabaseRepository:
    """Thin Supabase wrapper for trader persistence."""

    def __init__(self, url: str, service_role_key: str) -> None:
        if not url or not service_role_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self._http = _build_supabase_http_client()
        self.client: Client = create_client(
            url,
            service_role_key,
            options=ClientOptions(httpx_client=self._http),
        )
        self._lock = threading.RLock()
        self._cached_risk_sync_equity: Optional[float] = None
        self._known_position_symbols: Optional[set[str]] = None

    @_db_synchronized
    def update_bot_status(self, status: BotStatusUpdate) -> None:
        payload = {
            "enabled": status.enabled,
            "trading_mode": status.trading_mode.value,
            "execution_mode": status.execution_mode.value,
            "ibkr_connected": status.ibkr_connected,
            "jev_connected": status.jev_connected,
            "last_heartbeat": datetime.now(timezone.utc).isoformat(),
            "last_error": status.last_error,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.client.table("bot_status").update(payload).eq("id", 1).execute()

    @_db_synchronized
    def insert_portfolio_snapshot(
        self,
        account: AccountSummary,
        daily_pnl: float = 0.0,
        total_pnl: float = 0.0,
    ) -> None:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "balance": account.total_cash,
            "equity": account.net_liquidation,
            "daily_pnl": daily_pnl,
            "total_pnl": total_pnl,
            "currency": account.currency,
        }
        self.client.table("portfolio_history").insert(payload).execute()

    @_db_synchronized
    def _replace_positions(self, rows: List[dict], current_symbols: set[str]) -> None:
        if self._known_position_symbols is None:
            existing = self.client.table("positions").select("symbol").execute()
            self._known_position_symbols = {
                row["symbol"]
                for row in (existing.data or [])
                if row.get("symbol")
            }

        stale = self._known_position_symbols - current_symbols
        if stale:
            self.client.table("positions").delete().in_("symbol", list(stale)).execute()
        if rows:
            self.client.table("positions").upsert(rows, on_conflict="symbol").execute()
        self._known_position_symbols = current_symbols

    @_db_synchronized
    def upsert_positions(self, positions: List[Position]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            {
                "symbol": position.symbol,
                "quantity": position.quantity,
                "avg_cost": position.avg_cost,
                "market_price": position.market_price,
                "market_value": position.market_value,
                "unrealized_pnl": position.unrealized_pnl,
                "currency": position.currency,
                "updated_at": now,
            }
            for position in positions
        ]
        self._replace_positions(rows, {position.symbol for position in positions})

    @_db_synchronized
    def insert_market_snapshots(self, quotes: List[Quote]) -> None:
        if not quotes:
            return

        now = datetime.now(timezone.utc).isoformat()
        rows = [
            {
                "symbol": quote.symbol,
                "timestamp": now,
                "price": quote.price,
                "bid": quote.bid,
                "ask": quote.ask,
                "spread": quote.spread,
                "volume": quote.volume,
            }
            for quote in quotes
        ]
        self.client.table("market_snapshots").insert(rows).execute()

    @_db_synchronized
    def get_bot_control(
        self,
        fallback_execution_mode: ExecutionMode = ExecutionMode.IBKR,
    ) -> BotControl:
        try:
            result = (
                self.client.table("bot_status")
                .select("enabled, trading_mode, execution_mode")
                .eq("id", 1)
                .single()
                .execute()
            )
            data = result.data
            return BotControl(
                enabled=bool(data.get("enabled", False)),
                trading_mode=TradingMode(data.get("trading_mode", "paper")),
                execution_mode=ExecutionMode(
                    data.get("execution_mode", fallback_execution_mode.value)
                ),
            )
        except Exception as exc:
            logger.warning("Could not read bot_status: %s", exc)
            return BotControl(
                enabled=False,
                trading_mode=TradingMode.PAPER,
                execution_mode=fallback_execution_mode,
            )

    @_db_synchronized
    def mark_trader_offline(
        self,
        enabled: bool,
        trading_mode: TradingMode,
        execution_mode: ExecutionMode,
    ) -> None:
        """Clear connection flags and heartbeat when the trader process exits."""
        payload = {
            "enabled": enabled,
            "trading_mode": trading_mode.value,
            "execution_mode": execution_mode.value,
            "ibkr_connected": False,
            "jev_connected": False,
            "last_heartbeat": None,
            "last_error": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.client.table("bot_status").update(payload).eq("id", 1).execute()

    @_db_synchronized
    def get_settings(self) -> StrategySettings:
        risk = self.get_risk_settings()
        return StrategySettings(
            minimum_jev_confidence=risk.minimum_jev_confidence,
            signal_record_threshold=risk.signal_record_threshold,
            watchlist=risk.watchlist,
        )

    def _parse_jev_rankings(self, raw: object) -> List[JevRankedSymbol]:
        if not isinstance(raw, list):
            return []
        rankings: List[JevRankedSymbol] = []
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol", "")).upper()
            if not symbol:
                continue
            rankings.append(
                JevRankedSymbol(
                    symbol=symbol,
                    buy=float(item.get("buy", 0)),
                    hold=float(item.get("hold", 0)),
                    sell=float(item.get("sell", 0)),
                    rank=int(item.get("rank", index + 1)),
                )
            )
        return rankings

    @_db_synchronized
    def get_risk_settings(self) -> RiskSettings:
        result = (
            self.client.table("settings")
            .select(
                "minimum_jev_confidence, signal_record_threshold, risk_per_trade, "
                "max_position_size, max_daily_loss, max_open_positions, "
                "stop_loss_percentage, take_profit_percentage, max_hold_minutes, "
                "min_volume_ratio, min_share_price, "
                "account_capital, risk_sync_equity, watchlist, watchlist_core, "
                "watchlist_dynamic_enabled, watchlist_dynamic_size, "
                "watchlist_refresh_minutes, benchmark_symbol, watchlist_jev_rankings, "
                "watchlist_screener_ran_at, demotion_exits_enabled, demotion_max_hold_ratio, "
                "demotion_jev_sell_on_loss, demotion_jev_sell_max_loss_pct, demotion_force_exit"
            )
            .eq("id", 1)
            .single()
            .execute()
        )
        data = result.data
        watchlist = data.get("watchlist") or []
        watchlist_core = data.get("watchlist_core") or []
        if not watchlist_core and watchlist:
            watchlist_core = list(watchlist)
        risk_sync_equity = (
            float(data["risk_sync_equity"])
            if data.get("risk_sync_equity") is not None
            else None
        )
        self._cached_risk_sync_equity = risk_sync_equity
        screener_ran_at = data.get("watchlist_screener_ran_at")
        return RiskSettings(
            minimum_jev_confidence=float(data.get("minimum_jev_confidence", 0.85)),
            signal_record_threshold=float(data.get("signal_record_threshold", 0.80)),
            risk_per_trade=float(data.get("risk_per_trade", 2.5)),
            max_position_size=float(data.get("max_position_size", 250)),
            max_daily_loss=float(data.get("max_daily_loss", 10)),
            max_open_positions=int(data.get("max_open_positions", 2)),
            stop_loss_percentage=float(data.get("stop_loss_percentage", 0.01)),
            take_profit_percentage=float(data.get("take_profit_percentage", 0.015)),
            max_hold_minutes=float(data.get("max_hold_minutes", 0)),
            min_volume_ratio=float(data.get("min_volume_ratio", 0)),
            min_share_price=float(data.get("min_share_price", 50)),
            account_capital=float(data.get("account_capital", 1000)),
            risk_sync_equity=risk_sync_equity,
            watchlist=[str(s).upper() for s in watchlist],
            watchlist_core=[str(s).upper() for s in watchlist_core],
            watchlist_dynamic_enabled=bool(data.get("watchlist_dynamic_enabled", True)),
            watchlist_dynamic_size=int(data.get("watchlist_dynamic_size", 5)),
            watchlist_refresh_minutes=int(data.get("watchlist_refresh_minutes", 30)),
            benchmark_symbol=str(data.get("benchmark_symbol") or "EEM").upper(),
            watchlist_jev_rankings=self._parse_jev_rankings(
                data.get("watchlist_jev_rankings")
            ),
            watchlist_screener_ran_at=(
                _parse_timestamp(screener_ran_at) if screener_ran_at else None
            ),
            demotion_exits_enabled=bool(data.get("demotion_exits_enabled", True)),
            demotion_max_hold_ratio=float(data.get("demotion_max_hold_ratio", 0.5)),
            demotion_jev_sell_on_loss=bool(data.get("demotion_jev_sell_on_loss", True)),
            demotion_jev_sell_max_loss_pct=float(
                data.get("demotion_jev_sell_max_loss_pct", 0.02)
            ),
            demotion_force_exit=bool(data.get("demotion_force_exit", False)),
        )

    @_db_synchronized
    def update_effective_watchlist(
        self,
        watchlist: List[str],
        rankings: List[JevRankedSymbol],
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        rankings_payload = [
            {
                "symbol": item.symbol,
                "buy": item.buy,
                "hold": item.hold,
                "sell": item.sell,
                "rank": item.rank,
            }
            for item in rankings
        ]
        payload = {
            "watchlist": watchlist,
            "watchlist_jev_rankings": rankings_payload,
            "watchlist_screener_ran_at": now,
            "updated_at": now,
        }
        self.client.table("settings").update(payload).eq("id", 1).execute()
        try:
            self.client.table("watchlist_screener_history").insert(
                {
                    "ran_at": now,
                    "rankings": rankings_payload,
                    "watchlist": watchlist,
                }
            ).execute()
        except Exception as exc:
            logger.warning("Failed to log screener history: %s", exc)

    @_db_synchronized
    def update_effective_watchlist_fallback(self, watchlist: List[str]) -> None:
        """Persist always-on core fallback after a failed dynamic scan."""
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "watchlist": watchlist,
            "watchlist_jev_rankings": [],
            "watchlist_screener_ran_at": None,
            "updated_at": now,
        }
        self.client.table("settings").update(payload).eq("id", 1).execute()

    @_db_synchronized
    def get_em_universe_symbols(self, tradable_only: bool = True) -> List[str]:
        query = (
            self.client.table("em_universe")
            .select("symbol")
            .order("weight_bps", desc=True)
            .limit(MAX_EM_UNIVERSE_SIZE)
        )
        if tradable_only:
            query = query.eq("tradable", True)
        result = query.execute()
        symbols: List[str] = []
        for row in result.data or []:
            symbol = str(row.get("symbol", "")).strip().upper()
            if symbol and symbol not in symbols:
                symbols.append(symbol)
        return symbols

    @_db_synchronized
    def set_em_universe_tradable(self, symbol: str, tradable: bool) -> None:
        self.client.table("em_universe").update(
            {
                "tradable": tradable,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("symbol", symbol.upper()).execute()

    @_db_synchronized
    def get_bars(self, symbol: str, bar_size: str) -> List[Bar]:
        result = (
            self.client.table("symbol_bars")
            .select("symbol, bar_size, ts, open, high, low, close, volume")
            .eq("symbol", symbol.upper())
            .eq("bar_size", bar_size)
            .order("ts")
            .limit(2000)
            .execute()
        )
        bars: List[Bar] = []
        for row in result.data or []:
            bars.append(
                Bar(
                    symbol=str(row["symbol"]).upper(),
                    bar_size=str(row["bar_size"]),
                    ts=_parse_timestamp(row["ts"]),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=int(row.get("volume") or 0),
                )
            )
        return bars

    @_db_synchronized
    def upsert_bars(self, bars: List[Bar]) -> None:
        if not bars:
            return
        rows = [
            {
                "symbol": bar.symbol.upper(),
                "bar_size": bar.bar_size,
                "ts": _ensure_utc_iso(bar.ts),
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": bar.volume,
            }
            for bar in bars
        ]
        for start in range(0, len(rows), 500):
            chunk = rows[start : start + 500]
            self.client.table("symbol_bars").upsert(
                chunk,
                on_conflict="symbol,bar_size,ts",
            ).execute()

    @_db_synchronized
    def get_last_fetched_at(self, symbol: str, bar_size: str) -> Optional[datetime]:
        try:
            result = (
                self.client.table("symbol_bars_meta")
                .select("last_fetched_at")
                .eq("symbol", symbol.upper())
                .eq("bar_size", bar_size)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "Could not read symbol_bars_meta for %s %s: %s",
                symbol,
                bar_size,
                exc,
            )
            return None

        rows = result.data if result is not None else None
        if not rows:
            return None
        last_fetched_at = rows[0].get("last_fetched_at")
        if not last_fetched_at:
            return None
        return _parse_timestamp(last_fetched_at)

    @_db_synchronized
    def set_last_fetched_at(
        self,
        symbol: str,
        bar_size: str,
        fetched_at: datetime,
    ) -> None:
        payload = {
            "symbol": symbol.upper(),
            "bar_size": bar_size,
            "last_fetched_at": _ensure_utc_iso(fetched_at),
        }
        self.client.table("symbol_bars_meta").upsert(
            payload,
            on_conflict="symbol,bar_size",
        ).execute()

    @_db_synchronized
    def maybe_advance_risk_baseline(
        self,
        current_equity: float,
        threshold: float = 0.05,
    ) -> bool:
        """Advance risk_sync_equity when equity moves enough; does not change risk dollar fields."""
        if current_equity <= 0:
            return False

        baseline = self._cached_risk_sync_equity

        if not should_advance_baseline(current_equity, baseline, threshold):
            return False

        self.client.table("settings").update(
            {"risk_sync_equity": current_equity}
        ).eq("id", 1).execute()
        self._cached_risk_sync_equity = current_equity
        logger.info(
            "Risk recommendation baseline updated: %s -> %s",
            baseline,
            current_equity,
        )
        return True

    @_db_synchronized
    def get_open_trades(self) -> List[TradeRecord]:
        result = (
            self.client.table("trades")
            .select("*")
            .eq("status", "open")
            .order("entry_time")
            .execute()
        )
        return [_trade_from_row(row) for row in result.data or []]

    @_db_synchronized
    def get_daily_realized_pnl(self) -> float:
        today = datetime.now(timezone.utc).date().isoformat()
        result = (
            self.client.table("trades")
            .select("net_pnl")
            .eq("status", "closed")
            .gte("exit_time", f"{today}T00:00:00+00:00")
            .execute()
        )
        total = 0.0
        for row in result.data or []:
            if row.get("net_pnl") is not None:
                total += float(row["net_pnl"])
        return total

    @_db_synchronized
    def get_total_realized_pnl(self) -> float:
        result = (
            self.client.table("trades")
            .select("net_pnl")
            .eq("status", "closed")
            .execute()
        )
        total = 0.0
        for row in result.data or []:
            if row.get("net_pnl") is not None:
                total += float(row["net_pnl"])
        return total

    @_db_synchronized
    def insert_trade(self, trade: TradeRecord) -> str:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "id": trade.id,
            "symbol": trade.symbol,
            "side": trade.side,
            "entry_time": trade.entry_time.isoformat(),
            "entry_price": trade.entry_price,
            "quantity": trade.quantity,
            "position_value": trade.position_value,
            "stop_loss": trade.stop_loss,
            "take_profit": trade.take_profit,
            "status": trade.status,
            "paper_or_live": trade.paper_or_live,
            "jev_buy_probability": trade.jev_buy_probability,
            "execution_mode": trade.execution_mode,
            "ibkr_parent_order_id": trade.ibkr_parent_order_id,
            "ibkr_sl_order_id": trade.ibkr_sl_order_id,
            "ibkr_tp_order_id": trade.ibkr_tp_order_id,
            "commission": 0,
            "slippage": 0,
            "created_at": now,
            "updated_at": now,
        }
        self.client.table("trades").insert(payload).execute()
        return trade.id

    @_db_synchronized
    def update_trade_ibkr_bracket(self, trade: TradeRecord) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "stop_loss": trade.stop_loss,
            "take_profit": trade.take_profit,
            "ibkr_parent_order_id": trade.ibkr_parent_order_id,
            "ibkr_sl_order_id": trade.ibkr_sl_order_id,
            "ibkr_tp_order_id": trade.ibkr_tp_order_id,
            "updated_at": now,
        }
        self.client.table("trades").update(payload).eq("id", trade.id).execute()

    @_db_synchronized
    def close_trade(
        self,
        trade_id: str,
        exit_price: float,
        exit_time: datetime,
        gross_pnl: float,
        net_pnl: float,
        *,
        filled_quantity: Optional[float] = None,
        exit_reason: Optional[str] = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "exit_time": exit_time.isoformat(),
            "exit_price": exit_price,
            "gross_pnl": gross_pnl,
            "net_pnl": net_pnl,
            "status": "closed",
            "updated_at": now,
        }
        if filled_quantity is not None:
            payload["quantity"] = filled_quantity
            payload["position_value"] = round(exit_price * filled_quantity, 6)
        if exit_reason:
            payload["exit_reason"] = exit_reason
        self.client.table("trades").update(payload).eq("id", trade_id).execute()

    @_db_synchronized
    def sync_positions_from_trades(
        self,
        open_trades: List[TradeRecord],
        quotes: List[Quote],
    ) -> None:
        quotes_by_symbol = {q.symbol: q for q in quotes}
        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for trade in open_trades:
            quote = quotes_by_symbol.get(trade.symbol)
            market_price = quote.price if quote else trade.entry_price
            market_value = market_price * trade.quantity if market_price is not None else None
            unrealized = None
            if market_price is not None:
                unrealized = (market_price - trade.entry_price) * trade.quantity
            rows.append(
                {
                    "symbol": trade.symbol,
                    "quantity": trade.quantity,
                    "avg_cost": trade.entry_price,
                    "market_price": market_price,
                    "market_value": market_value,
                    "unrealized_pnl": unrealized,
                    "currency": "USD",
                    "updated_at": now,
                }
            )
        self._replace_positions(rows, {trade.symbol for trade in open_trades})

    @_db_synchronized
    def _sync_positions(
        self,
        quotes: List[Quote],
        *,
        ibkr_positions: Optional[List[Position]] = None,
        open_trades: Optional[List[TradeRecord]] = None,
    ) -> None:
        if ibkr_positions is not None:
            self.upsert_positions(ibkr_positions)
        elif open_trades is not None:
            self.sync_positions_from_trades(open_trades, quotes)

    @_db_synchronized
    def _write_portfolio_snapshot(
        self,
        *,
        account: Optional[AccountSummary] = None,
        simulated_portfolio: Optional[SimulatedPortfolio] = None,
    ) -> None:
        if account is not None:
            self.insert_portfolio_snapshot(account)
        elif simulated_portfolio is not None:
            self.insert_simulated_portfolio(simulated_portfolio)

    @_db_synchronized
    def write_portfolio_state(
        self,
        quotes: List[Quote],
        *,
        account: Optional[AccountSummary] = None,
        ibkr_positions: Optional[List[Position]] = None,
        simulated_portfolio: Optional[SimulatedPortfolio] = None,
        open_trades: Optional[List[TradeRecord]] = None,
    ) -> None:
        """Persist equity and positions immediately (e.g. on trade open/close)."""
        self._write_portfolio_snapshot(
            account=account,
            simulated_portfolio=simulated_portfolio,
        )
        self._sync_positions(
            quotes,
            ibkr_positions=ibkr_positions,
            open_trades=open_trades,
        )

    @_db_synchronized
    def write_heartbeat(
        self,
        status: BotStatusUpdate,
        quotes: List[Quote],
        *,
        account: Optional[AccountSummary] = None,
        ibkr_positions: Optional[List[Position]] = None,
        simulated_portfolio: Optional[SimulatedPortfolio] = None,
        open_trades: Optional[List[TradeRecord]] = None,
        include_portfolio_history: bool = True,
        include_market_snapshots: bool = False,
    ) -> None:
        if include_portfolio_history:
            self._write_portfolio_snapshot(
                account=account,
                simulated_portfolio=simulated_portfolio,
            )
        self._sync_positions(
            quotes,
            ibkr_positions=ibkr_positions,
            open_trades=open_trades,
        )
        if include_market_snapshots:
            self.insert_market_snapshots(quotes)
        self.update_bot_status(status)

    @_db_synchronized
    def insert_simulated_portfolio(self, portfolio: SimulatedPortfolio) -> None:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "balance": portfolio.balance,
            "equity": portfolio.equity,
            "daily_pnl": portfolio.daily_pnl,
            "total_pnl": portfolio.total_pnl,
            "currency": portfolio.currency,
        }
        self.client.table("portfolio_history").insert(payload).execute()

    @_db_synchronized
    def insert_prediction(
        self,
        state: MarketState,
        prediction: JevPrediction,
        trade_created: bool = False,
        trade_skip_reason: Optional[str] = None,
    ) -> None:
        payload = {
            "symbol": prediction.symbol,
            "timestamp": prediction.timestamp.isoformat(),
            "price": state.price,
            "buy_probability": prediction.buy,
            "hold_probability": prediction.hold,
            "sell_probability": prediction.sell,
            "market_snapshot": state.to_dict(),
            "trade_created": trade_created,
            "trade_skip_reason": None if trade_created else trade_skip_reason,
        }
        self.client.table("predictions").insert(payload).execute()

    @_db_synchronized
    def upsert_market_news(self, rows: List[dict], *, keep: int = 100) -> int:
        if not rows:
            return 0
        deduped = dedupe_market_news_rows(rows)
        if not deduped:
            return 0
        self.client.table("market_news").upsert(deduped, on_conflict="id").execute()
        overflow = (
            self.client.table("market_news")
            .select("id")
            .order("published_at", desc=True)
            .range(keep, keep + 999)
            .execute()
        )
        stale_ids = [row["id"] for row in (overflow.data or [])]
        if stale_ids:
            self.client.table("market_news").delete().in_("id", stale_ids).execute()
        return len(deduped)

    @_db_synchronized
    def reclaim_stale_trade_commands(self, stale_after_sec: float = 120.0) -> int:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(seconds=stale_after_sec)
        ).isoformat()
        result = (
            self.client.table("trade_commands")
            .update({"status": "pending", "processed_at": None, "error": None})
            .eq("status", "processing")
            .lt("processed_at", cutoff)
            .execute()
        )
        return len(result.data or [])

    @_db_synchronized
    def get_pending_trade_commands(self) -> List[dict]:
        result = (
            self.client.table("trade_commands")
            .select("id, trade_id, command, reason, requested_at")
            .eq("status", "pending")
            .order("requested_at")
            .limit(10)
            .execute()
        )
        return list(result.data or [])

    @_db_synchronized
    def claim_trade_command(self, command_id: str) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self.client.table("trade_commands")
            .update({"status": "processing", "processed_at": now})
            .eq("id", command_id)
            .eq("status", "pending")
            .execute()
        )
        return bool(result.data)

    @_db_synchronized
    def complete_trade_command(self, command_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("trade_commands").update(
            {"status": "completed", "processed_at": now, "error": None}
        ).eq("id", command_id).execute()

    @_db_synchronized
    def fail_trade_command(self, command_id: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("trade_commands").update(
            {"status": "failed", "processed_at": now, "error": error[:500]}
        ).eq("id", command_id).execute()

    @_db_synchronized
    def record_error(
        self,
        message: str,
        enabled: bool,
        trading_mode: TradingMode,
        execution_mode: ExecutionMode = ExecutionMode.IBKR,
    ) -> None:
        try:
            self.update_bot_status(
                BotStatusUpdate(
                    enabled=enabled,
                    trading_mode=trading_mode,
                    ibkr_connected=False,
                    jev_connected=False,
                    execution_mode=execution_mode,
                    last_error=message,
                )
            )
        except Exception:
            logger.exception("Failed to record error to Supabase")
