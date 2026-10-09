from __future__ import annotations

from database.supabase_support import *  # noqa: F403

class SupabaseBotControlMixin:
    @_db_synchronized
    def get_bot_control(
        self,
        fallback_execution_mode: ExecutionMode = ExecutionMode.IBKR,
    ) -> BotControl:
        try:
            result = (
                self.client.table("bot_status")
                .select("enabled, trading_mode, execution_mode, shutdown_requested")
                .eq("id", 1)
                .single()
                .execute()
            )
            data = result.data
            return BotControl(
                enabled=bool(data.get("enabled", False)),
                trading_mode=TradingMode(data.get("trading_mode", "paper")),
                execution_mode=ExecutionMode(
                    data.get("execution_mode", fallback_execution_mode.value)
                ),
                shutdown_requested=bool(data.get("shutdown_requested", False)),
            )
        except Exception as exc:
            logger.warning("Could not read bot_status: %s", exc)
            return BotControl(
                enabled=False,
                trading_mode=TradingMode.PAPER,
                execution_mode=fallback_execution_mode,
                shutdown_requested=False,
            )

    @_db_synchronized
    def get_trader_status_snapshot(self) -> Dict[str, object]:
        """Lightweight bot_status row for diagnostics scripts."""
        result = (
            self.client.table("bot_status")
            .select("ibkr_connected, jev_connected, last_heartbeat, last_error")
            .eq("id", 1)
            .single()
            .execute()
        )
        return dict(result.data or {})

    @_db_synchronized
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
            "shutdown_requested": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.client.table("bot_status").update(payload).eq("id", 1).execute()

    @_db_synchronized
    def mark_shutdown_gate_offline(
        self,
        enabled: bool,
        trading_mode: TradingMode,
        execution_mode: ExecutionMode,
    ) -> None:
        """Keep shutdown_requested set; clear heartbeat so the dashboard shows offline."""
        payload = {
            "enabled": enabled,
            "trading_mode": trading_mode.value,
            "execution_mode": execution_mode.value,
            "ibkr_connected": False,
            "jev_connected": False,
            "last_heartbeat": None,
            "last_error": None,
            "shutdown_requested": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.client.table("bot_status").update(payload).eq("id", 1).execute()

    @_db_synchronized
    def get_last_heartbeat(self) -> Optional[str]:
        try:
            result = (
                self.client.table("bot_status")
                .select("last_heartbeat")
                .eq("id", 1)
                .single()
                .execute()
            )
            raw = result.data.get("last_heartbeat")
            return str(raw) if raw else None
        except Exception as exc:
            logger.warning("Could not read bot_status heartbeat: %s", exc)
            return None

    @_db_synchronized
    def poll_shutdown_requested(self) -> bool:
        try:
            result = (
                self.client.table("bot_status")
                .select("shutdown_requested")
                .eq("id", 1)
                .single()
                .execute()
            )
            return bool(result.data.get("shutdown_requested", False))
        except Exception as exc:
            logger.warning("Could not poll shutdown_requested: %s", exc)
            return False
