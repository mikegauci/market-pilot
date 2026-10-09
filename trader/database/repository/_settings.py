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

    @staticmethod
    def _parse_rotation_session_pct(data: dict) -> Optional[float]:
        raw = data.get("rotation_min_session_change_pct")
        if raw is None:
            return None
        return float(raw)

    @staticmethod
    def _apply_rotation_defaults(data: dict) -> None:
        data.setdefault("watchlist_pool", [])
        data.setdefault("watchlist_active", [])
        data.setdefault("watchlist_rotation_enabled", False)
        data.setdefault("watchlist_active_size", 12)
        data.setdefault("watchlist_rotation_interval_minutes", 15)
        data.setdefault("watchlist_max_swaps_per_rotation", 2)
        data.setdefault("watchlist_last_rotation_note", "")
        data.setdefault("watchlist_rotation_history", [])
        data.setdefault("entry_blocked_symbols", [])
        data.setdefault("entry_blocked_at", {})

    @staticmethod
    def _normalize_symbol_list(raw: object) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for item in raw or []:
            symbol = str(item).strip().upper()
            if symbol and symbol not in seen:
                seen.add(symbol)
                ordered.append(symbol)
        return ordered

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

    # Optional columns where NULL means "not set": drop the key so get_risk_settings uses
    # the built-in default and *_from_settings stays False (matches the trader env fallback).
    _NULL_MEANS_UNSET = (
        "max_entries_per_symbol_per_day",
        "entry_ema_gate",
        "max_rsi",
        "max_spread_pct",
        "breakout_max_rsi",
        "breakout_window_minutes",
        "breakout_max_promotions_per_cycle",
        "breakout_lookback_minutes",
        "breakout_min_volume_ratio",
        "breakout_min_change_5m_pct",
    )

    def _load_settings_row(self) -> dict:
        """One read of the settings row. Columns an older schema lacks are simply absent,
        and get_risk_settings falls back to its defaults for them."""
        data = self._select_settings_row("*")
        if data is None:
            raise RuntimeError("Unable to load settings row from Supabase")
        for key in self._NULL_MEANS_UNSET:
            if key in data and data[key] is None:
                del data[key]
        return data

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
        from strategy.exits import normalize_loss_cut_fractions

        loss_min, loss_max = normalize_loss_cut_fractions(
            float(data.get("loss_cut_min_fraction", 0.70)),
            float(data.get("loss_cut_max_fraction", 0.90)),
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
            max_entries_per_symbol_per_day=int(
                data.get("max_entries_per_symbol_per_day", 3)
            ),
            rotation_min_session_change_pct=(
                SupabaseSettingsMixin._parse_rotation_session_pct(data)
                if "rotation_min_session_change_pct" in data
                else 0.0
            ),
            rotation_session_pct_from_settings=(
                "rotation_min_session_change_pct" in data
            ),
            entry_ema_gate=(
                str(data["entry_ema_gate"]).strip().lower()
                if "entry_ema_gate" in data
                else "ema_20"
            ),
            entry_ema_gate_from_settings=("entry_ema_gate" in data),
            max_rsi=float(data.get("max_rsi", 70)),
            max_rsi_from_settings=("max_rsi" in data),
            max_spread_pct=float(data.get("max_spread_pct", 0.0015)),
            max_spread_pct_from_settings=("max_spread_pct" in data),
            breakout_enabled=bool(data.get("breakout_enabled", True)),
            breakout_lookback_minutes=int(data.get("breakout_lookback_minutes", 10)),
            breakout_min_volume_ratio=float(data.get("breakout_min_volume_ratio", 1.5)),
            breakout_min_change_5m_pct=float(data.get("breakout_min_change_5m_pct", 0.15)),
            breakout_max_promotions_per_cycle=int(
                data.get("breakout_max_promotions_per_cycle", 2)
            ),
            breakout_window_minutes=float(data.get("breakout_window_minutes", 10.0)),
            breakout_max_rsi=float(data.get("breakout_max_rsi", 82.0)),
            breakout_from_settings=("breakout_enabled" in data),
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
            loss_cut_enabled=bool(data.get("loss_cut_enabled", False)),
            loss_cut_min_fraction=loss_min,
            loss_cut_max_fraction=loss_max,
            loss_cut_min_band_hits=int(data.get("loss_cut_min_band_hits", 3)),
            loss_cut_band_window_cycles=int(
                data.get("loss_cut_band_window_cycles", 10)
            ),
            loss_cut_jev_sell_threshold=float(
                data.get("loss_cut_jev_sell_threshold", 0.0)
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
            entry_blocked_symbols=self._normalize_symbol_list(
                data.get("entry_blocked_symbols")
            ),
            entry_blocked_at=self._normalize_entry_blocked_at(
                data.get("entry_blocked_at")
            ),
        )

    @staticmethod
    def _normalize_entry_blocked_at(raw: object) -> dict[str, str]:
        if not isinstance(raw, dict):
            return {}
        normalized: dict[str, str] = {}
        for key, value in raw.items():
            symbol = str(key).strip().upper()
            if not symbol or value is None:
                continue
            normalized[symbol] = str(value)
        return normalized

    @_db_synchronized
    def save_entry_block_state(
        self,
        symbols: List[str],
        blocked_at: dict[str, str],
        *,
        watchlist_active: Optional[List[str]] = None,
        rotation_note: Optional[str] = None,
    ) -> None:
        payload: dict = {
            "entry_blocked_symbols": [symbol.upper() for symbol in symbols],
            "entry_blocked_at": blocked_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if watchlist_active is not None:
            payload["watchlist_active"] = [symbol.upper() for symbol in watchlist_active]
        if rotation_note:
            payload["watchlist_last_rotation_note"] = rotation_note[:240]
        self.client.table("settings").update(payload).eq("id", 1).execute()

    @_db_synchronized
    def get_watchlist_rotation_history(self) -> list:
        row = self._select_settings_row("watchlist_rotation_history")
        history = (row or {}).get("watchlist_rotation_history")
        return history if isinstance(history, list) else []

    @_db_synchronized
    def save_watchlist_rotation(
        self,
        active: List[str],
        note: str,
        *,
        history_entry: Optional[dict] = None,
        touch_rotation_at: bool = True,
    ) -> None:
        """Persist the bot-owned active list. Does not touch the manual watchlist or pool."""
        from watchlist.rotation_history import prepend_rotation_history

        payload: dict = {
            "watchlist_active": [symbol.upper() for symbol in active],
            "watchlist_last_rotation_note": note[:240],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if touch_rotation_at:
            # The dashboard counts down to the next rotation from this timestamp.
            payload["watchlist_last_rotation_at"] = datetime.now(timezone.utc).isoformat()
        if history_entry is not None:
            row = self._select_settings_row("watchlist_rotation_history")
            existing: object = (row or {}).get("watchlist_rotation_history") or []
            payload["watchlist_rotation_history"] = prepend_rotation_history(
                existing, history_entry
            )
        self.client.table("settings").update(payload).eq("id", 1).execute()
