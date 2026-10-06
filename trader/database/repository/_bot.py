from __future__ import annotations

from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

class SupabaseBotStatusMixin:
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
        payload["ibkr_account_id"] = status.ibkr_account_id
        self.client.table("bot_status").update(payload).eq("id", 1).execute()
