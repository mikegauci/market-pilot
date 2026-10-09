"""Settings rows as PostgREST returns them, for get_risk_settings characterization tests."""
from __future__ import annotations

import copy
from types import SimpleNamespace

FULL_ROW = {
    "id": 1,
    "trading_mode": "paper",
    "minimum_jev_confidence": 0.82,
    "signal_record_threshold": 0.75,
    "risk_per_trade": 3.0,
    "max_position_size": 400.0,
    "max_daily_loss": 25.0,
    "max_open_positions": 3,
    "stop_loss_percentage": 0.012,
    "take_profit_percentage": 0.02,
    "account_capital": 5000.0,
    "watchlist": ["spy", "qqq"],
    "updated_at": "2026-10-09T10:00:00+00:00",
    "risk_sync_equity": 5100.5,
    "risk_profile": "medium",
    "max_hold_minutes": 90,
    "benchmark_symbol": " qqq ",
    "min_volume_ratio": 0.8,
    "min_share_price": 15,
    "min_hold_minutes": 10,
    "jev_sell_exit_threshold": 0.9,
    "reentry_cooldown_minutes": 30,
    "min_dollar_volume": 500000,
    "confirmation_cycles": 3,
    "confirmation_seconds": 45,
    "profit_take_enabled": True,
    "profit_take_min_fraction": 0.6,
    "profit_take_max_fraction": 0.85,
    "profit_take_min_band_hits": 2,
    "profit_take_band_window_cycles": 8,
    "profit_take_jev_sell_threshold": 0.65,
    "watchlist_pool": ["nvda", "amd", " "],
    "watchlist_active": ["nvda"],
    "watchlist_rotation_enabled": True,
    "watchlist_active_size": 10,
    "watchlist_rotation_interval_minutes": 20,
    "watchlist_max_swaps_per_rotation": 3,
    "watchlist_last_rotation_note": "rotated",
    "watchlist_last_rotation_at": "2026-10-09T09:45:00+00:00",
    "entry_blocked_symbols": ["tsla", "TSLA", "aapl"],
    "entry_blocked_at": {"tsla": "2026-10-09T09:00:00+00:00", "x": None},
    "loss_cut_enabled": True,
    "loss_cut_min_fraction": 0.5,
    "loss_cut_max_fraction": 0.95,
    "loss_cut_min_band_hits": 4,
    "loss_cut_band_window_cycles": 12,
    "loss_cut_jev_sell_threshold": 0.3,
    "max_entries_per_symbol_per_day": 5,
    "rotation_min_session_change_pct": 0.4,
    "watchlist_rotation_history": [],
    "entry_ema_gate": " EMA_9 ",
    "max_rsi": 72,
    "max_spread_pct": 0.002,
    "breakout_enabled": False,
    "breakout_max_rsi": 85,
    "breakout_window_minutes": 12,
    "breakout_max_promotions_per_cycle": 1,
    "breakout_lookback_minutes": 15,
    "breakout_min_volume_ratio": 2.0,
    "breakout_min_change_5m_pct": 0.2,
}


def with_nulls() -> dict:
    """Nullable optional columns set to NULL (the old merge skipped NULLs)."""
    row = copy.deepcopy(FULL_ROW)
    for key in (
        "risk_sync_equity",
        "rotation_min_session_change_pct",
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
    ):
        row[key] = None
    return row


def legacy_without(*prefixes: str) -> dict:
    """An older schema missing whole column groups."""
    return {
        k: copy.deepcopy(v)
        for k, v in FULL_ROW.items()
        if not any(k.startswith(p) or k == p for p in prefixes)
    }


SCENARIOS = {
    "full": lambda: copy.deepcopy(FULL_ROW),
    "nulls": with_nulls,
    "no_breakout": lambda: legacy_without("breakout_"),
    "no_loss_cut_rotation": lambda: legacy_without(
        "loss_cut_", "watchlist_pool", "watchlist_active", "watchlist_rotation",
        "watchlist_max_swaps", "watchlist_last_rotation", "entry_blocked",
        "max_entries_per_symbol_per_day", "rotation_min_session_change_pct",
        "entry_ema_gate", "max_rsi", "max_spread_pct", "breakout_",
    ),
    "core_only": lambda: legacy_without(
        "profit_take_", "loss_cut_", "confirmation_", "min_dollar_volume",
        "watchlist_pool", "watchlist_active", "watchlist_rotation", "watchlist_max_swaps",
        "watchlist_last_rotation", "entry_blocked", "max_entries_per_symbol_per_day",
        "rotation_min_session_change_pct", "entry_ema_gate", "max_rsi", "max_spread_pct",
        "breakout_",
    ),
}


class SchemaSettingsClient:
    """Answers settings selects like PostgREST: unknown columns are an error, `*` returns the row."""

    def __init__(self, row: dict) -> None:
        self.row = row
        self.selects: list[str] = []

    def table(self, name: str) -> "SchemaSettingsClient":
        assert name == "settings"
        return self

    def select(self, columns: str) -> "SchemaSettingsClient":
        self.selects.append(columns)
        self._columns = columns
        return self

    def eq(self, *args) -> "SchemaSettingsClient":
        return self

    def single(self) -> "SchemaSettingsClient":
        return self

    def execute(self) -> SimpleNamespace:
        if self._columns.strip() == "*":
            return SimpleNamespace(data=copy.deepcopy(self.row))
        wanted = [c.strip() for c in self._columns.split(",") if c.strip()]
        missing = [c for c in wanted if c not in self.row]
        if missing:
            raise RuntimeError(f"column settings.{missing[0]} does not exist")
        return SimpleNamespace(data={c: copy.deepcopy(self.row[c]) for c in wanted})
