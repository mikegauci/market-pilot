from __future__ import annotations

from database.supabase_support import *  # noqa: F403
from database.trade_account_scope import apply_trade_account_filter

class SupabaseSettingsMixin:
    @_db_synchronized
    def get_settings(self) -> StrategySettings:
        risk = self.get_risk_settings()
        return StrategySettings(
            minimum_jev_confidence=risk.minimum_jev_confidence,
            signal_record_threshold=risk.signal_record_threshold,
            watchlist=risk.watchlist,
        )

    _SETTINGS_SELECT_CORE = (
        "minimum_jev_confidence, signal_record_threshold, risk_per_trade, "
        "max_position_size, max_daily_loss, max_open_positions, "
        "stop_loss_percentage, take_profit_percentage, max_hold_minutes, "
        "min_hold_minutes, jev_sell_exit_threshold, reentry_cooldown_minutes, "
        "min_volume_ratio, min_share_price, "
        "account_capital, risk_sync_equity, watchlist, benchmark_symbol"
    )
    _SETTINGS_SELECT_WITH_PROFIT_TAKE = (
        f"{_SETTINGS_SELECT_CORE}, "
        "profit_take_enabled, profit_take_min_fraction, profit_take_max_fraction, "
        "profit_take_min_band_hits, profit_take_band_window_cycles, "
        "profit_take_jev_sell_threshold"
    )
    _SETTINGS_SELECT_BASE = (
        f"{_SETTINGS_SELECT_WITH_PROFIT_TAKE}, confirmation_cycles, confirmation_seconds"
    )
    _SETTINGS_SELECT_ROTATION = (
        "watchlist_pool, watchlist_active, watchlist_rotation_enabled, "
        "watchlist_active_size, watchlist_rotation_interval_minutes, "
        "watchlist_max_swaps_per_rotation, watchlist_last_rotation_note"
    )

    @staticmethod
    def _apply_profit_take_defaults(data: dict) -> None:
        data.setdefault("profit_take_enabled", False)
        data.setdefault("profit_take_min_fraction", 0.70)
        data.setdefault("profit_take_max_fraction", 0.80)
        data.setdefault("profit_take_min_band_hits", 3)
        data.setdefault("profit_take_band_window_cycles", 10)
        data.setdefault("profit_take_jev_sell_threshold", 0.70)

    @staticmethod
    def _apply_rotation_defaults(data: dict) -> None:
        data.setdefault("watchlist_pool", [])
        data.setdefault("watchlist_active", [])
        data.setdefault("watchlist_rotation_enabled", False)
        data.setdefault("watchlist_active_size", 12)
        data.setdefault("watchlist_rotation_interval_minutes", 15)
        data.setdefault("watchlist_max_swaps_per_rotation", 2)
        data.setdefault("watchlist_last_rotation_note", "")

    def _select_settings_row(self, columns: str) -> Optional[dict]:
        try:
            result = (
                self.client.table("settings")
                .select(columns)
                .eq("id", 1)
                .single()
                .execute()
            )
            return dict(result.data or {})
        except Exception:
            return None

    def _load_settings_row(self) -> dict:
        data = self._select_settings_row(
            f"{self._SETTINGS_SELECT_BASE}, min_dollar_volume, {self._SETTINGS_SELECT_ROTATION}"
        )
        if data is not None:
            return data

        logger.warning(
            "Settings read without rotation columns — using defaults",
        )
        data = self._select_settings_row(f"{self._SETTINGS_SELECT_BASE}, min_dollar_volume")
        if data is not None:
            self._apply_rotation_defaults(data)
            return data

        logger.warning(
            "Settings read without min_dollar_volume — using default",
        )
        data = self._select_settings_row(self._SETTINGS_SELECT_BASE)
        if data is not None:
            data.setdefault("min_dollar_volume", 250_000)
            return data

        logger.warning(
            "Settings read without profit_take columns — using defaults",
        )
        data = self._select_settings_row(
            f"{self._SETTINGS_SELECT_CORE}, confirmation_cycles, confirmation_seconds, "
            "min_dollar_volume"
        )
        if data is not None:
            self._apply_profit_take_defaults(data)
            return data

        logger.warning(
            "Settings read without confirmation_cycles/confirmation_seconds — using defaults",
        )
        data = self._select_settings_row(f"{self._SETTINGS_SELECT_CORE}, min_dollar_volume")
        if data is not None:
            data.setdefault("confirmation_cycles", 2)
            data.setdefault("confirmation_seconds", 30)
            self._apply_profit_take_defaults(data)
            return data

        data = self._select_settings_row(self._SETTINGS_SELECT_CORE)
        if data is not None:
            data.setdefault("min_dollar_volume", 250_000)
            data.setdefault("confirmation_cycles", 2)
            data.setdefault("confirmation_seconds", 30)
            self._apply_profit_take_defaults(data)
            return data

        raise RuntimeError("Unable to load settings row from Supabase")

    @_db_synchronized
    def get_risk_settings(self) -> RiskSettings:
        data = self._load_settings_row()
        self._apply_rotation_defaults(data)
        watchlist = data.get("watchlist") or []
        risk_sync_equity = (
            float(data["risk_sync_equity"])
            if data.get("risk_sync_equity") is not None
            else None
        )
        self._cached_risk_sync_equity = risk_sync_equity
        profit_min, profit_max = normalize_profit_take_fractions(
            float(data.get("profit_take_min_fraction", 0.70)),
            float(data.get("profit_take_max_fraction", 0.80)),
        )
        return RiskSettings(
            minimum_jev_confidence=float(data.get("minimum_jev_confidence", 0.85)),
            signal_record_threshold=float(data.get("signal_record_threshold", 0.80)),
            risk_per_trade=float(data.get("risk_per_trade", 2.5)),
            max_position_size=float(data.get("max_position_size", 250)),
            max_daily_loss=float(data.get("max_daily_loss", 10)),
            max_open_positions=int(data.get("max_open_positions", 2)),
            stop_loss_percentage=float(data.get("stop_loss_percentage", 0.01)),
            take_profit_percentage=float(data.get("take_profit_percentage", 0.015)),
            max_hold_minutes=float(data.get("max_hold_minutes", 0)),
            min_hold_minutes=float(data.get("min_hold_minutes", 15)),
            jev_sell_exit_threshold=float(data.get("jev_sell_exit_threshold", 0.95)),
            reentry_cooldown_minutes=float(data.get("reentry_cooldown_minutes", 45)),
            confirmation_cycles=int(data.get("confirmation_cycles", 2)),
            confirmation_seconds=float(int(data.get("confirmation_seconds", 30))),
            min_volume_ratio=float(data.get("min_volume_ratio", 0.5)),
            min_share_price=float(data.get("min_share_price", 20)),
            min_dollar_volume=float(data.get("min_dollar_volume", 250_000)),
            account_capital=float(data.get("account_capital", 1000)),
            risk_sync_equity=risk_sync_equity,
            watchlist=[str(s).upper() for s in watchlist],
            benchmark_symbol=str(data.get("benchmark_symbol") or "").strip().upper(),
            profit_take_enabled=bool(data.get("profit_take_enabled", False)),
            profit_take_min_fraction=profit_min,
            profit_take_max_fraction=profit_max,
            profit_take_min_band_hits=int(data.get("profit_take_min_band_hits", 3)),
            profit_take_band_window_cycles=int(
                data.get("profit_take_band_window_cycles", 10)
            ),
            profit_take_jev_sell_threshold=float(
                data.get("profit_take_jev_sell_threshold", 0.70)
            ),
            watchlist_pool=[str(s).upper() for s in (data.get("watchlist_pool") or []) if str(s).strip()],
            watchlist_active=[str(s).upper() for s in (data.get("watchlist_active") or []) if str(s).strip()],
            watchlist_rotation_enabled=bool(data.get("watchlist_rotation_enabled", False)),
            watchlist_active_size=int(data.get("watchlist_active_size", 12)),
            watchlist_rotation_interval_minutes=int(
                data.get("watchlist_rotation_interval_minutes", 15)
            ),
            watchlist_max_swaps_per_rotation=int(
                data.get("watchlist_max_swaps_per_rotation", 2)
            ),
            watchlist_last_rotation_note=str(data.get("watchlist_last_rotation_note") or ""),
        )

    @_db_synchronized
    def save_watchlist_rotation(self, active: List[str], note: str) -> None:
        """Persist the bot-owned active list. Does not touch the manual watchlist or pool."""
        self.client.table("settings").update(
            {
                "watchlist_active": [symbol.upper() for symbol in active],
                "watchlist_last_rotation_note": note[:240],
                "watchlist_last_rotation_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", 1).execute()
