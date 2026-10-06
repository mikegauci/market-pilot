from __future__ import annotations

from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

class SupabaseTradesMixin:
    @_db_synchronized
    def get_open_trades(
        self,
        ibkr_account_id: Optional[str] = None,
    ) -> List[TradeRecord]:
        query = (
            self.client.table("trades")
            .select("*")
            .eq("status", "open")
            .order("entry_time")
        )
        if ibkr_account_id:
            query = apply_trade_account_filter(
                query,
                ibkr_account_id,
                include_legacy=self._include_legacy_untagged(ibkr_account_id),
            )
        result = query.execute()
        return [_trade_from_row(row) for row in result.data or []]

    @_db_synchronized
    def get_recent_symbol_exit_times(
        self,
        lookback_minutes: float,
    ) -> Dict[str, datetime]:
        """Latest closed-trade exit time per symbol within the lookback window."""
        if lookback_minutes <= 0:
            return {}
        since = datetime.now(timezone.utc) - timedelta(minutes=float(lookback_minutes))
        result = (
            self.client.table("trades")
            .select("symbol, exit_time")
            .eq("status", "closed")
            .gte("exit_time", since.isoformat())
            .order("exit_time", desc=True)
            .execute()
        )
        latest: Dict[str, datetime] = {}
        for row in result.data or []:
            symbol = str(row.get("symbol") or "").upper()
            raw_exit = row.get("exit_time")
            if not symbol or not raw_exit:
                continue
            if symbol in latest:
                continue
            latest[symbol] = _parse_timestamp(raw_exit)
        return latest

    @_db_synchronized
    def get_daily_realized_pnl(self, ibkr_account_id: Optional[str] = None) -> float:
        day_start = trading_day_start_utc()
        query = (
            self.client.table("trades")
            .select("net_pnl")
            .eq("status", "closed")
            .gte("exit_time", day_start.isoformat())
        )
        if ibkr_account_id:
            query = apply_trade_account_filter(
                query,
                ibkr_account_id,
                include_legacy=self._include_legacy_untagged(ibkr_account_id),
            )
        result = query.execute()
        total = 0.0
        for row in result.data or []:
            if row.get("net_pnl") is not None:
                total += float(row["net_pnl"])
        return total

    @_db_synchronized
    def get_total_realized_pnl(self, ibkr_account_id: Optional[str] = None) -> float:
        query = (
            self.client.table("trades")
            .select("net_pnl")
            .eq("status", "closed")
        )
        if ibkr_account_id:
            query = apply_trade_account_filter(
                query,
                ibkr_account_id,
                include_legacy=self._include_legacy_untagged(ibkr_account_id),
            )
        result = query.execute()
        total = 0.0
        for row in result.data or []:
            if row.get("net_pnl") is not None:
                total += float(row["net_pnl"])
        return total

    @_db_synchronized
    def _trade_exists(self, trade_id: str) -> bool:
        result = (
            self.client.table("trades")
            .select("id")
            .eq("id", trade_id)
            .limit(1)
            .execute()
        )
        return bool(result.data)

    @_db_synchronized
    def insert_trade(
        self,
        trade: TradeRecord,
        *,
        alert_daily_pnl: Optional[float] = None,
        alert_equity: Optional[float] = None,
    ) -> str:
        if self._trade_exists(trade.id):
            logger.warning(
                "insert_trade skipped — %s already persisted (idempotent)",
                trade.id,
            )
            return trade.id
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
            "commission": float(trade.entry_commission or 0),
            "slippage": 0,
            "created_at": now,
            "updated_at": now,
        }
        if trade.ibkr_account_id:
            payload["ibkr_account_id"] = trade.ibkr_account_id
        try:
            self.client.table("trades").insert(payload).execute()
        except Exception as exc:
            if self._trade_exists(trade.id):
                logger.warning(
                    "insert_trade duplicate after ambiguous error — treating as success: %s",
                    exc,
                )
                return trade.id
            raise
        if trade.ibkr_account_id:
            self.invalidate_legacy_untagged_cache()
        self._schedule_open_alert(
            trade,
            daily_pnl=alert_daily_pnl,
            equity=alert_equity,
        )
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
        alert_daily_pnl: Optional[float] = None,
        alert_equity: Optional[float] = None,
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
        result = (
            self.client.table("trades")
            .update(payload)
            .eq("id", trade_id)
            .eq("status", "open")
            .select("symbol")
            .execute()
        )
        rows = result.data or []
        if rows:
            symbol = rows[0].get("symbol")
            if symbol:
                self._schedule_close_alert(
                    str(symbol),
                    net_pnl,
                    exit_reason,
                    daily_pnl=alert_daily_pnl,
                    equity=alert_equity,
                )

    @staticmethod
    def _schedule_open_alert(
        trade: TradeRecord,
        *,
        daily_pnl: Optional[float] = None,
        equity: Optional[float] = None,
    ) -> None:
        try:
            notify_trade_opened(trade, daily_pnl=daily_pnl, equity=equity)
        except Exception:
            logger.warning(
                "Trade open alert failed to schedule for %s",
                trade.symbol,
            )

    @staticmethod
    def _schedule_close_alert(
        symbol: str,
        net_pnl: float,
        exit_reason: Optional[str],
        *,
        daily_pnl: Optional[float] = None,
        equity: Optional[float] = None,
    ) -> None:
        try:
            notify_trade_closed(
                symbol,
                net_pnl,
                exit_reason,
                daily_pnl=daily_pnl,
                equity=equity,
            )
        except Exception:
            logger.warning("Trade close alert failed to schedule for %s", symbol)

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

    @staticmethod
    def _unrealized_pnl_from_positions(
        positions: Optional[List[Position]],
    ) -> float:
        if not positions:
            return 0.0
        return sum(float(p.unrealized_pnl or 0.0) for p in positions)

    @_db_synchronized
    def _write_portfolio_snapshot(
        self,
        *,
        account: Optional[AccountSummary] = None,
        simulated_portfolio: Optional[SimulatedPortfolio] = None,
        unrealized_pnl: float = 0.0,
    ) -> None:
        if account is not None:
            profile = self.ensure_account_profile(
                account.account_id,
                account.net_liquidation,
                unrealized_pnl=unrealized_pnl,
            )
            baseline = float(profile.get("baseline_equity", account.net_liquidation))
            if account.ibkr_daily_pnl is not None:
                daily_pnl = account.ibkr_daily_pnl
            else:
                daily_pnl = (
                    self.get_daily_realized_pnl(account.account_id) + unrealized_pnl
                )
            total_pnl = account.net_liquidation - baseline
            self.sync_account_capital_for_profile(
                account.account_id,
                account.net_liquidation,
            )
            self.insert_portfolio_snapshot(
                account,
                daily_pnl=daily_pnl,
                total_pnl=total_pnl,
            )
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
            unrealized_pnl=self._unrealized_pnl_from_positions(ibkr_positions),
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
                unrealized_pnl=self._unrealized_pnl_from_positions(ibkr_positions),
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
