"""Canonical config fingerprint for decision/execution logging."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, is_dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

from models.types import RiskSettings

# Fields that affect order sizing, entries, exits, and risk gates.
_ORDER_AFFECTING_KEYS = (
    "minimum_jev_confidence",
    "signal_record_threshold",
    "risk_per_trade",
    "max_position_size",
    "max_daily_loss",
    "max_open_positions",
    "stop_loss_percentage",
    "take_profit_percentage",
    "max_hold_minutes",
    "min_hold_minutes",
    "jev_sell_exit_threshold",
    "reentry_cooldown_minutes",
    "prediction_horizon_minutes",
    "last_entry_cutoff_minutes_before_close",
    "eod_closeout_enabled",
    "eod_closeout_minutes_before_close",
    "account_capital",
    "min_volume_ratio",
    "min_share_price",
    "stale_input_gates_enabled",
    "max_quote_age_sec",
    "confirmation_mode",
    "confirmation_count",
    "pre_submit_recheck_enabled",
    "max_entry_price_drift_frac",
    "demotion_exits_enabled",
    "demotion_max_hold_ratio",
    "demotion_jev_sell_on_loss",
    "demotion_jev_sell_max_loss_pct",
    "demotion_force_exit",
    "daily_loss_include_unrealized",
    "daily_loss_include_fees",
    "daily_loss_action",
    "drawdown_breaker_enabled",
    "drawdown_max_frac",
    "reconcile_protect_orphans",
)


def _json_safe(value: Any) -> Any:
    if is_dataclass(value) and not isinstance(value, type):
        return {k: _json_safe(v) for k, v in asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in sorted(value.items(), key=lambda x: str(x[0]))}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, float):
        return round(value, 10)
    return value


def risk_settings_to_config_dict(settings: RiskSettings) -> Dict[str, Any]:
    raw = asdict(settings) if is_dataclass(settings) else dict(settings)  # type: ignore[arg-type]
    out: Dict[str, Any] = {}
    for key in _ORDER_AFFECTING_KEYS:
        if key in raw:
            out[key] = _json_safe(raw[key])
    return out


def fingerprint_config(config: Mapping[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Return (sha256 hex, canonical config dict)."""
    canonical = _json_safe(dict(config))
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return digest, canonical  # type: ignore[return-value]


def fingerprint_risk_settings(settings: RiskSettings) -> Tuple[str, Dict[str, Any]]:
    return fingerprint_config(risk_settings_to_config_dict(settings))
