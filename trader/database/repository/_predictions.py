from __future__ import annotations

from database.supabase_support import *  # noqa: F403

class SupabasePredictionsMixin:

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
