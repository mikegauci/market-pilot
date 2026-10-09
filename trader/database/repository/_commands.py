from __future__ import annotations

import time

from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

# Commands only count as stale after ~120s, so checking more often just adds an UPDATE per poll.
RECLAIM_MIN_INTERVAL_SEC = 30.0


class SupabaseCommandsMixin:
    def _reclaim_due(self, table: str) -> bool:
        """Throttle stale-command reclaim per table; the first call always runs."""
        last = self.__dict__.get("_last_reclaim_mono", {})
        return table not in last or time.monotonic() - last[table] >= RECLAIM_MIN_INTERVAL_SEC

    def _reclaim_done(self, table: str) -> None:
        """Record a successful reclaim, so a failed UPDATE is retried on the next poll."""
        self.__dict__.setdefault("_last_reclaim_mono", {})[table] = time.monotonic()

    @_db_synchronized
    def reclaim_stale_trade_commands(self, stale_after_sec: float = 120.0) -> int:
        if not self._reclaim_due("trade_commands"):
            return 0
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
        self._reclaim_done("trade_commands")
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
    def reclaim_stale_position_commands(self, stale_after_sec: float = 120.0) -> int:
        if not self._reclaim_due("position_commands"):
            return 0
        cutoff = (
            datetime.now(timezone.utc) - timedelta(seconds=stale_after_sec)
        ).isoformat()
        result = (
            self.client.table("position_commands")
            .update({"status": "pending", "processed_at": None, "error": None})
            .eq("status", "processing")
            .lt("processed_at", cutoff)
            .execute()
        )
        self._reclaim_done("position_commands")
        return len(result.data or [])

    @_db_synchronized
    def get_pending_position_commands(self) -> List[dict]:
        result = (
            self.client.table("position_commands")
            .select("id, symbol, quantity, command, reason, requested_at")
            .eq("status", "pending")
            .order("requested_at")
            .limit(10)
            .execute()
        )
        return list(result.data or [])

    @_db_synchronized
    def claim_position_command(self, command_id: str) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self.client.table("position_commands")
            .update({"status": "processing", "processed_at": now})
            .eq("id", command_id)
            .eq("status", "pending")
            .execute()
        )
        return bool(result.data)

    @_db_synchronized
    def complete_position_command(self, command_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("position_commands").update(
            {"status": "completed", "processed_at": now, "error": None}
        ).eq("id", command_id).execute()

    @_db_synchronized
    def fail_position_command(self, command_id: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("position_commands").update(
            {"status": "failed", "processed_at": now, "error": error[:500]}
        ).eq("id", command_id).execute()

    @_db_synchronized
    def reclaim_stale_entry_commands(self, stale_after_sec: float = 120.0) -> int:
        if not self._reclaim_due("entry_commands"):
            return 0
        cutoff = (
            datetime.now(timezone.utc) - timedelta(seconds=stale_after_sec)
        ).isoformat()
        result = (
            self.client.table("entry_commands")
            .update({"status": "pending", "processed_at": None, "error": None})
            .eq("status", "processing")
            .lt("processed_at", cutoff)
            .execute()
        )
        self._reclaim_done("entry_commands")
        return len(result.data or [])

    @_db_synchronized
    def get_pending_entry_commands(self) -> List[dict]:
        result = (
            self.client.table("entry_commands")
            .select("id, symbol, quantity, command, reason, requested_at")
            .eq("status", "pending")
            .order("requested_at")
            .limit(10)
            .execute()
        )
        return list(result.data or [])

    @_db_synchronized
    def claim_entry_command(self, command_id: str) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self.client.table("entry_commands")
            .update({"status": "processing", "processed_at": now})
            .eq("id", command_id)
            .eq("status", "pending")
            .execute()
        )
        return bool(result.data)

    @_db_synchronized
    def complete_entry_command(self, command_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("entry_commands").update(
            {"status": "completed", "processed_at": now, "error": None}
        ).eq("id", command_id).execute()

    @_db_synchronized
    def fail_entry_command(self, command_id: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table("entry_commands").update(
            {"status": "failed", "processed_at": now, "error": error[:500]}
        ).eq("id", command_id).execute()

    @_db_synchronized
    def defer_entry_command(self, command_id: str, reason: str) -> None:
        """Return a claimed command to pending for transient conditions (retried next cycle)."""
        self.client.table("entry_commands").update(
            {
                "status": "pending",
                "processed_at": None,
                "error": reason[:500],
            }
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
