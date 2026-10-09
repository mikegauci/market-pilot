from __future__ import annotations

import time

from database.command_queue import STALE_PROCESSING_SEC
from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

# Commands only count as stale after ~120s, so checking more often just adds an UPDATE per poll.
RECLAIM_MIN_INTERVAL_SEC = 30.0


class SupabaseCommandsMixin:
    def _reclaim_due(self, table: str) -> bool:
        """Throttle stale-command reclaim per table; the first call always runs."""
        last = self._last_reclaim_mono
        return table not in last or time.monotonic() - last[table] >= RECLAIM_MIN_INTERVAL_SEC

    def _reclaim_done(self, table: str) -> None:
        """Record a successful reclaim, so a failed UPDATE is retried on the next poll."""
        self._last_reclaim_mono[table] = time.monotonic()

    # Shared implementation for the three dashboard command queues
    # (trade_commands, position_commands, entry_commands). Callers hold the DB lock.

    def _reclaim_stale_commands(self, table: str, stale_after_sec: float) -> int:
        if not self._reclaim_due(table):
            return 0
        cutoff = (
            datetime.now(timezone.utc) - timedelta(seconds=stale_after_sec)
        ).isoformat()
        result = (
            self.client.table(table)
            .update({"status": "pending", "processed_at": None, "error": None})
            .eq("status", "processing")
            .lt("processed_at", cutoff)
            .execute()
        )
        self._reclaim_done(table)
        return len(result.data or [])

    def _pending_commands(self, table: str, columns: str) -> List[dict]:
        result = (
            self.client.table(table)
            .select(columns)
            .eq("status", "pending")
            .order("requested_at")
            .limit(10)
            .execute()
        )
        return list(result.data or [])

    def _claim_command(self, table: str, command_id: str) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self.client.table(table)
            .update({"status": "processing", "processed_at": now})
            .eq("id", command_id)
            .eq("status", "pending")
            .execute()
        )
        return bool(result.data)

    def _finish_command(self, table: str, command_id: str, error: Optional[str]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.client.table(table).update(
            {
                "status": "failed" if error is not None else "completed",
                "processed_at": now,
                "error": error[:500] if error is not None else None,
            }
        ).eq("id", command_id).execute()

    @_db_synchronized
    def reclaim_stale_trade_commands(self, stale_after_sec: float = STALE_PROCESSING_SEC) -> int:
        return self._reclaim_stale_commands("trade_commands", stale_after_sec)

    @_db_synchronized
    def get_pending_trade_commands(self) -> List[dict]:
        return self._pending_commands("trade_commands", "id, trade_id, command, reason, requested_at")

    @_db_synchronized
    def claim_trade_command(self, command_id: str) -> bool:
        return self._claim_command("trade_commands", command_id)

    @_db_synchronized
    def complete_trade_command(self, command_id: str) -> None:
        self._finish_command("trade_commands", command_id, None)

    @_db_synchronized
    def fail_trade_command(self, command_id: str, error: str) -> None:
        self._finish_command("trade_commands", command_id, error)

    @_db_synchronized
    def reclaim_stale_position_commands(self, stale_after_sec: float = STALE_PROCESSING_SEC) -> int:
        return self._reclaim_stale_commands("position_commands", stale_after_sec)

    @_db_synchronized
    def get_pending_position_commands(self) -> List[dict]:
        return self._pending_commands("position_commands", "id, symbol, quantity, command, reason, requested_at")

    @_db_synchronized
    def claim_position_command(self, command_id: str) -> bool:
        return self._claim_command("position_commands", command_id)

    @_db_synchronized
    def complete_position_command(self, command_id: str) -> None:
        self._finish_command("position_commands", command_id, None)

    @_db_synchronized
    def fail_position_command(self, command_id: str, error: str) -> None:
        self._finish_command("position_commands", command_id, error)

    @_db_synchronized
    def reclaim_stale_entry_commands(self, stale_after_sec: float = STALE_PROCESSING_SEC) -> int:
        return self._reclaim_stale_commands("entry_commands", stale_after_sec)

    @_db_synchronized
    def get_pending_entry_commands(self) -> List[dict]:
        return self._pending_commands("entry_commands", "id, symbol, quantity, command, reason, requested_at")

    @_db_synchronized
    def claim_entry_command(self, command_id: str) -> bool:
        return self._claim_command("entry_commands", command_id)

    @_db_synchronized
    def complete_entry_command(self, command_id: str) -> None:
        self._finish_command("entry_commands", command_id, None)

    @_db_synchronized
    def fail_entry_command(self, command_id: str, error: str) -> None:
        self._finish_command("entry_commands", command_id, error)

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
