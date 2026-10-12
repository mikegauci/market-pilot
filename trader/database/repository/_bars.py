from __future__ import annotations

from postgrest.types import ReturnMethod

from database.supabase_support import *  # noqa: F403

DEFAULT_INTRADAY_LOOKBACK_DAYS = 8
MAX_BAR_ROWS = 5000


class SupabaseBarsMixin:
    def _query_bars(
        self,
        symbol: str,
        bar_size: str,
        *,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
    ) -> List[Bar]:
        if since is None and bar_size != "1 day":
            # Intraday history grows every session; PostgREST caps a response at 1000 rows and
            # we sort oldest-first, so an unbounded read would silently drop today's bars.
            since = datetime.now(timezone.utc) - timedelta(days=DEFAULT_INTRADAY_LOOKBACK_DAYS)
        rows: list = []
        page_size = 1000
        offset = 0
        while True:
            query = (
                self.client.table("symbol_bars")
                .select("symbol, bar_size, ts, open, high, low, close, volume")
                .eq("symbol", symbol.upper())
                .eq("bar_size", bar_size)
            )
            if since is not None:
                query = query.gte("ts", _ensure_utc_iso(since))
            if until is not None:
                query = query.lte("ts", _ensure_utc_iso(until))
            page = query.order("ts").range(offset, offset + page_size - 1).execute().data or []
            rows.extend(page)
            if len(page) < page_size or len(rows) >= MAX_BAR_ROWS:
                break
            offset += page_size
        bars: List[Bar] = []
        for row in rows:
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
    def get_bars(
        self,
        symbol: str,
        bar_size: str,
        *,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
    ) -> List[Bar]:
        return self._query_bars(symbol, bar_size, since=since, until=until)

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
                returning=ReturnMethod.minimal,
            ).execute()

    @_db_synchronized
    def get_latest_bar_ts(self, symbol: str, bar_size: str) -> Optional[datetime]:
        try:
            result = (
                self.client.table("symbol_bars")
                .select("ts")
                .eq("symbol", symbol.upper())
                .eq("bar_size", bar_size)
                .order("ts", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "Could not read latest bar ts for %s %s: %s",
                symbol,
                bar_size,
                exc,
            )
            return None
        rows = result.data if result is not None else None
        if not rows:
            return None
        ts = rows[0].get("ts")
        if not ts:
            return None
        return _parse_timestamp(ts)

    @_db_synchronized
    def count_bars(self, symbol: str, bar_size: str) -> int:
        try:
            result = (
                self.client.table("symbol_bars")
                .select("ts", count="exact")
                .eq("symbol", symbol.upper())
                .eq("bar_size", bar_size)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "Could not count bars for %s %s: %s",
                symbol,
                bar_size,
                exc,
            )
            return 0
        count = getattr(result, "count", None)
        if count is not None:
            return int(count)
        rows = result.data if result is not None else None
        return len(rows or [])

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
            returning=ReturnMethod.minimal,
        ).execute()

    @_db_synchronized
    def maybe_advance_risk_baseline(
        self,
        current_equity: float,
        threshold: float = 0.05,
        *,
        ibkr_account_id: Optional[str] = None,
    ) -> bool:
        """Advance risk_sync_equity when equity moves enough; does not change risk dollar fields."""
        if current_equity <= 0:
            return False

        if ibkr_account_id:
            if self._cached_risk_sync_account_id != ibkr_account_id:
                profile = self.get_account_profile(ibkr_account_id)
                self._cached_risk_sync_equity = (
                    float(profile["risk_sync_equity"])
                    if profile and profile.get("risk_sync_equity") is not None
                    else None
                )
                self._cached_risk_sync_account_id = ibkr_account_id

            baseline = self._cached_risk_sync_equity
            if not should_advance_baseline(current_equity, baseline, threshold):
                return False

            now = datetime.now(timezone.utc).isoformat()
            self.client.table("ibkr_account_profiles").update(
                {"risk_sync_equity": current_equity, "updated_at": now}
            ).eq("account_id", ibkr_account_id).execute()
            self._cached_risk_sync_equity = current_equity
            logger.info(
                "Risk recommendation baseline updated for %s: %s -> %s",
                ibkr_account_id,
                baseline,
                current_equity,
            )
            return True

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
