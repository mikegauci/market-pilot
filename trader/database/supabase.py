from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from supabase import Client, create_client

from models.types import (
    AccountSummary,
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

logger = logging.getLogger(__name__)


def _parse_timestamp(value: object) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).replace("Z", "+00:00")
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
        execution_mode=str(row.get("execution_mode", "simulated")),
        ibkr_parent_order_id=int(row["ibkr_parent_order_id"]) if row.get("ibkr_parent_order_id") is not None else None,
        ibkr_sl_order_id=int(row["ibkr_sl_order_id"]) if row.get("ibkr_sl_order_id") is not None else None,
        ibkr_tp_order_id=int(row["ibkr_tp_order_id"]) if row.get("ibkr_tp_order_id") is not None else None,
    )


class SupabaseRepository:
    """Thin Supabase wrapper for trader persistence."""

    def __init__(self, url: str, service_role_key: str) -> None:
        if not url or not service_role_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.client: Client = create_client(url, service_role_key)

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

    def upsert_positions(self, positions: List[Position]) -> None:
        # Replace snapshot: delete rows not in current IBKR positions, upsert the rest.
        current_symbols = {p.symbol for p in positions}

        existing = self.client.table("positions").select("symbol").execute()
        for row in existing.data or []:
            symbol = row.get("symbol")
            if symbol and symbol not in current_symbols:
                self.client.table("positions").delete().eq("symbol", symbol).execute()

        now = datetime.now(timezone.utc).isoformat()
        for position in positions:
            payload = {
                "symbol": position.symbol,
                "quantity": position.quantity,
                "avg_cost": position.avg_cost,
                "market_price": position.market_price,
                "market_value": position.market_value,
                "unrealized_pnl": position.unrealized_pnl,
                "currency": position.currency,
                "updated_at": now,
            }
            self.client.table("positions").upsert(payload, on_conflict="symbol").execute()

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

    def get_bot_enabled(self) -> bool:
        result = self.client.table("bot_status").select("enabled").eq("id", 1).single().execute()
        return bool(result.data.get("enabled", False))

    def get_trading_mode(self) -> TradingMode:
        result = (
            self.client.table("bot_status")
            .select("trading_mode")
            .eq("id", 1)
            .single()
            .execute()
        )
        mode = result.data.get("trading_mode", "paper")
        return TradingMode(mode)

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

    def get_execution_mode(self, fallback: ExecutionMode = ExecutionMode.SIMULATED) -> ExecutionMode:
        try:
            result = (
                self.client.table("bot_status")
                .select("execution_mode")
                .eq("id", 1)
                .single()
                .execute()
            )
            mode = result.data.get("execution_mode", fallback.value)
            return ExecutionMode(mode)
        except Exception as exc:
            logger.warning("Could not read execution_mode from bot_status: %s", exc)
            return fallback

    def get_settings(self) -> StrategySettings:
        risk = self.get_risk_settings()
        return StrategySettings(
            minimum_jev_confidence=risk.minimum_jev_confidence,
            signal_record_threshold=risk.signal_record_threshold,
            watchlist=risk.watchlist,
        )

    def get_risk_settings(self) -> RiskSettings:
        result = (
            self.client.table("settings")
            .select(
                "minimum_jev_confidence, signal_record_threshold, risk_per_trade, "
                "max_position_size, max_daily_loss, max_open_positions, "
                "stop_loss_percentage, take_profit_percentage, account_capital, watchlist"
            )
            .eq("id", 1)
            .single()
            .execute()
        )
        data = result.data
        watchlist = data.get("watchlist") or []
        return RiskSettings(
            minimum_jev_confidence=float(data.get("minimum_jev_confidence", 0.8)),
            signal_record_threshold=float(data.get("signal_record_threshold", 0.75)),
            risk_per_trade=float(data.get("risk_per_trade", 2.5)),
            max_position_size=float(data.get("max_position_size", 250)),
            max_daily_loss=float(data.get("max_daily_loss", 10)),
            max_open_positions=int(data.get("max_open_positions", 2)),
            stop_loss_percentage=float(data.get("stop_loss_percentage", 0.01)),
            take_profit_percentage=float(data.get("take_profit_percentage", 0.015)),
            account_capital=float(data.get("account_capital", 1000)),
            watchlist=[str(s).upper() for s in watchlist],
        )

    def get_open_trades(self) -> List[TradeRecord]:
        result = (
            self.client.table("trades")
            .select("*")
            .eq("status", "open")
            .order("entry_time")
            .execute()
        )
        return [_trade_from_row(row) for row in result.data or []]

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

    def close_trade(
        self,
        trade_id: str,
        exit_price: float,
        exit_time: datetime,
        gross_pnl: float,
        net_pnl: float,
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
        self.client.table("trades").update(payload).eq("id", trade_id).execute()

    def sync_positions_from_trades(
        self,
        open_trades: List[TradeRecord],
        quotes: List[Quote],
    ) -> None:
        quotes_by_symbol = {q.symbol: q for q in quotes}
        current_symbols = {t.symbol for t in open_trades}

        existing = self.client.table("positions").select("symbol").execute()
        for row in existing.data or []:
            symbol = row.get("symbol")
            if symbol and symbol not in current_symbols:
                self.client.table("positions").delete().eq("symbol", symbol).execute()

        now = datetime.now(timezone.utc).isoformat()
        for trade in open_trades:
            quote = quotes_by_symbol.get(trade.symbol)
            market_price = quote.price if quote else trade.entry_price
            market_value = market_price * trade.quantity if market_price is not None else None
            unrealized = None
            if market_price is not None:
                unrealized = (market_price - trade.entry_price) * trade.quantity

            payload = {
                "symbol": trade.symbol,
                "quantity": trade.quantity,
                "avg_cost": trade.entry_price,
                "market_price": market_price,
                "market_value": market_value,
                "unrealized_pnl": unrealized,
                "currency": "USD",
                "updated_at": now,
            }
            self.client.table("positions").upsert(payload, on_conflict="symbol").execute()

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

    def insert_prediction(
        self,
        state: MarketState,
        prediction: JevPrediction,
        trade_created: bool = False,
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
        }
        self.client.table("predictions").insert(payload).execute()

    def record_error(
        self,
        message: str,
        enabled: bool,
        trading_mode: TradingMode,
        execution_mode: ExecutionMode = ExecutionMode.SIMULATED,
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
