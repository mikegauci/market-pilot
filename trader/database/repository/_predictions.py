from __future__ import annotations

from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

class SupabasePredictionsMixin:
    def build_prediction_payload(
        self,
        state: MarketState,
        prediction: JevPrediction,
        *,
        trade_created: bool = False,
        trade_skip_reason: Optional[str] = None,
    ) -> dict:
        return _build_prediction_payload(
            state,
            prediction,
            trade_created=trade_created,
            trade_skip_reason=trade_skip_reason,
        )

    @_db_synchronized
    def insert_prediction(
        self,
        state: MarketState,
        prediction: JevPrediction,
        trade_created: bool = False,
        trade_skip_reason: Optional[str] = None,
    ) -> None:
        payload = self.build_prediction_payload(
            state,
            prediction,
            trade_created=trade_created,
            trade_skip_reason=trade_skip_reason,
        )
        self.client.table("predictions").insert(payload).execute()

    def _prediction_payload(self, *args, **kwargs) -> dict:
        """Backward-compatible alias for :meth:`build_prediction_payload`."""
        return self.build_prediction_payload(*args, **kwargs)

    @_db_synchronized
    def insert_predictions_batch(
        self,
        rows: List[dict],
    ) -> None:
        if not rows:
            return
        self.client.table("predictions").insert(rows).execute()

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
