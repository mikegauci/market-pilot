from __future__ import annotations

from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

class SupabasePortfolioMixin:
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
            "ibkr_account_id": account.account_id,
            "ibkr_accrued_cash": account.ibkr_accrued_cash,
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
