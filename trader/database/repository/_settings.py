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
    _SETTINGS_SELECT_WITH_LOSS_CUT = (
        f"{_SETTINGS_SELECT_WITH_PROFIT_TAKE}, "
        "loss_cut_enabled, loss_cut_min_fraction, loss_cut_max_fraction, "
        "loss_cut_min_band_hits, loss_cut_band_window_cycles, "
        "loss_cut_jev_sell_threshold"
    )
    _SETTINGS_SELECT_BASE = (
        f"{_SETTINGS_SELECT_WITH_LOSS_CUT}, confirmation_cycles, confirmation_seconds"
    )
    _SETTINGS_SELECT_ROTATION = (
        "watchlist_pool, watchlist_active, watchlist_rotation_enabled, "
        "watchlist_active_size, watchlist_rotation_interval_minutes, "
        "watchlist_max_swaps_per_rotation, watchlist_last_rotation_note, "
        "watchlist_rotation_history, entry_blocked_symbols, entry_blocked_at"
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
    def _apply_loss_cut_defaults(data: dict) -> None:
        data.setdefault("loss_cut_enabled", False)
        data.setdefault("loss_cut_min_fraction", 0.70)
        data.setdefault("loss_cut_max_fraction", 0.90)
        data.setdefault("loss_cut_min_band_hits", 3)
        data.setdefault("loss_cut_band_window_cycles", 10)
        data.setdefault("loss_cut_jev_sell_threshold", 0.0)

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

    def _merge_optional_settings_columns(self, data: dict) -> None:
        row = self._select_settings_row(
            "max_entries_per_symbol_per_day, rotation_min_session_change_pct, "
            "entry_ema_gate, max_rsi, max_spread_pct"
        )
        if row is None:
            data.setdefault("max_entries_per_symbol_per_day", 3)
        else:
            if row.get("max_entries_per_symbol_per_day") is not None:
                data["max_entries_per_symbol_per_day"] = row[
                    "max_entries_per_symbol_per_day"
                ]
            else:
                data.setdefault("max_entries_per_symbol_per_day", 3)
            if "rotation_min_session_change_pct" in row:
                raw_rotation = row.get("rotation_min_session_change_pct")
                data["rotation_min_session_change_pct"] = (
                    None if raw_rotation is None else float(raw_rotation)
                )
            if "entry_ema_gate" in row and row.get("entry_ema_gate") is not None:
                data["entry_ema_gate"] = str(row["entry_ema_gate"]).strip().lower()
            if "max_rsi" in row and row.get("max_rsi") is not None:
                data["max_rsi"] = float(row["max_rsi"])
            if "max_spread_pct" in row and row.get("max_spread_pct") is not None:
                data["max_spread_pct"] = float(row["max_spread_pct"])

        breakout_row = self._select_settings_row(
            "breakout_enabled, breakout_max_rsi, breakout_window_minutes, "
            "breakout_max_promotions_per_cycle, breakout_lookback_minutes, "
            "breakout_min_volume_ratio, breakout_min_change_5m_pct"
        )
        if breakout_row is None:
            return
        if "breakout_enabled" in breakout_row:
            data["breakout_enabled"] = bool(
                breakout_row.get("breakout_enabled", True)
            )
        if (
            "breakout_max_rsi" in breakout_row
            and breakout_row.get("breakout_max_rsi") is not None
        ):
            data["breakout_max_rsi"] = float(breakout_row["breakout_max_rsi"])
        if (
            "breakout_window_minutes" in breakout_row
            and breakout_row.get("breakout_window_minutes") is not None
        ):
            data["breakout_window_minutes"] = float(
                breakout_row["breakout_window_minutes"]
            )
        if (
            "breakout_max_promotions_per_cycle" in breakout_row
            and breakout_row.get("breakout_max_promotions_per_cycle") is not None
        ):
            data["breakout_max_promotions_per_cycle"] = int(
                breakout_row["breakout_max_promotions_per_cycle"]
            )
        if (
            "breakout_lookback_minutes" in breakout_row
            and breakout_row.get("breakout_lookback_minutes") is not None
        ):
            data["breakout_lookback_minutes"] = int(
                breakout_row["breakout_lookback_minutes"]
            )
        if (
            "breakout_min_volume_ratio" in breakout_row
            and breakout_row.get("breakout_min_volume_ratio") is not None
        ):
            data["breakout_min_volume_ratio"] = float(
                breakout_row["breakout_min_volume_ratio"]
            )
        if (
            "breakout_min_change_5m_pct" in breakout_row
            and breakout_row.get("breakout_min_change_5m_pct") is not None
        ):
            data["breakout_min_change_5m_pct"] = float(
                breakout_row["breakout_min_change_5m_pct"]
            )

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
            "Settings read without loss_cut columns — using defaults",
        )
        data = self._select_settings_row(
            f"{self._SETTINGS_SELECT_WITH_PROFIT_TAKE}, confirmation_cycles, "
            "confirmation_seconds, min_dollar_volume, "
            f"{self._SETTINGS_SELECT_ROTATION}"
        )
        if data is not None:
            self._apply_loss_cut_defaults(data)
            return data

        data = self._select_settings_row(
            f"{self._SETTINGS_SELECT_WITH_PROFIT_TAKE}, confirmation_cycles, "
            "confirmation_seconds, min_dollar_volume"
        )
        if data is not None:
            self._apply_rotation_defaults(data)
            self._apply_loss_cut_defaults(data)
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
            self._apply_loss_cut_defaults(data)
            return data

        logger.warning(
            "Settings read without confirmation_cycles/confirmation_seconds — using defaults",
        )
        data = self._select_settings_row(f"{self._SETTINGS_SELECT_CORE}, min_dollar_volume")
        if data is not None:
            data.setdefault("confirmation_cycles", 2)
            data.setdefault("confirmation_seconds", 30)
            self._apply_profit_take_defaults(data)
            self._apply_loss_cut_defaults(data)
            return data

        data = self._select_settings_row(self._SETTINGS_SELECT_CORE)
        if data is not None:
            data.setdefault("min_dollar_volume", 250_000)
            data.setdefault("confirmation_cycles", 2)
            data.setdefault("confirmation_seconds", 30)
            self._apply_profit_take_defaults(data)
            self._apply_loss_cut_defaults(data)
            return data

        raise RuntimeError("Unable to load settings row from Supabase")

    @_db_synchronized
    def get_risk_settings(self) -> RiskSettings:
        data = self._load_settings_row()
        self._apply_rotation_defaults(data)
        self._merge_optional_settings_columns(data)
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
    def save_watchlist_rotation(
        self,
        active: List[str],
        note: str,
        *,
        history_entry: Optional[dict] = None,
    ) -> None:
        """Persist the bot-owned active list. Does not touch the manual watchlist or pool."""
        from watchlist.rotation_history import prepend_rotation_history

        payload: dict = {
            "watchlist_active": [symbol.upper() for symbol in active],
            "watchlist_last_rotation_note": note[:240],
            "watchlist_last_rotation_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if history_entry is not None:
            existing: object = []
            try:
                row = (
                    self.client.table("settings")
                    .select("watchlist_rotation_history")
                    .eq("id", 1)
                    .single()
                    .execute()
                )
                if row.data:
                    existing = row.data.get("watchlist_rotation_history") or []
            except Exception:
                existing = []
            payload["watchlist_rotation_history"] = prepend_rotation_history(
                existing, history_entry
            )
        self.client.table("settings").update(payload).eq("id", 1).execute()
