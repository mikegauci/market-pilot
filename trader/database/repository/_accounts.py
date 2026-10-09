from __future__ import annotations

import time

from database.supabase_support import *  # noqa: F403

# Profiles are written once (baseline at creation); re-read occasionally in case of manual edits.
ACCOUNT_PROFILE_CACHE_TTL_SEC = 600.0


class SupabaseAccountsMixin:
    @_db_synchronized
    def get_account_profile(self, account_id: str) -> Optional[dict]:
        # Avoid maybe_single(): execute() returns None when no row (not an empty .data).
        result = (
            self.client.table("ibkr_account_profiles")
            .select("*")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if result is None or not result.data:
            return None
        return result.data[0]

    @_db_synchronized
    def ensure_account_profile(
        self,
        account_id: str,
        equity: float,
        *,
        unrealized_pnl: float = 0.0,
    ) -> dict:
        cached = self._account_profile_cache.get(account_id)
        if cached is not None and time.monotonic() - cached[0] < ACCOUNT_PROFILE_CACHE_TTL_SEC:
            return cached[1]

        existing = self.get_account_profile(account_id)
        if existing:
            self._account_profile_cache[account_id] = (time.monotonic(), existing)
            return existing

        realized = self.get_total_realized_pnl(account_id)
        baseline = equity - realized - unrealized_pnl
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "account_id": account_id,
            "baseline_equity": baseline,
            "account_capital": equity,
            "risk_sync_equity": equity,
            "created_at": now,
            "updated_at": now,
        }
        self.client.table("ibkr_account_profiles").upsert(
            payload,
            on_conflict="account_id",
            ignore_duplicates=True,
        ).execute()
        created = self.get_account_profile(account_id)
        if created:
            self._account_profile_cache[account_id] = (time.monotonic(), created)
            logger.info(
                "New IBKR account profile %s (baseline equity $%.2f)",
                account_id,
                float(created.get("baseline_equity", baseline)),
            )
            return created
        return payload

    @_db_synchronized
    def sync_account_capital_for_profile(
        self,
        account_id: str,
        equity: float,
    ) -> None:
        """Keep per-account account_capital aligned with live equity snapshots."""
        prev = self._profile_capital_cache.get(account_id)
        if prev is not None and abs(prev - equity) < 0.01:
            return
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("ibkr_account_profiles").update(
            {"account_capital": equity, "updated_at": now}
        ).eq("account_id", account_id).execute()
        self._profile_capital_cache[account_id] = equity
