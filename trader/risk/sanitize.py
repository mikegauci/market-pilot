"""Engine-side sanitize + env hard ceilings for order-affecting risk settings.

DB values are never trusted above absolute safe ranges or optional RISK_CEILING_* env caps.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Mapping, MutableMapping, Optional, Tuple

logger = logging.getLogger(__name__)

# Absolute safe ranges: (lo, hi, default). Applied before optional env ceilings.
_SAFE_RANGES: Dict[str, Tuple[float, float, float]] = {
    "minimum_jev_confidence": (0.50, 0.99, 0.85),
    "signal_record_threshold": (0.40, 0.99, 0.80),
    "risk_per_trade": (0.5, 500.0, 2.5),
    "max_position_size": (10.0, 50_000.0, 250.0),
    "max_daily_loss": (1.0, 10_000.0, 10.0),
    "max_open_positions": (1, 20, 2),
    "stop_loss_percentage": (0.002, 0.10, 0.01),
    "take_profit_percentage": (0.002, 0.20, 0.015),
    "max_hold_minutes": (0, 480, 0),
    "min_hold_minutes": (0, 240, 15),
    "jev_sell_exit_threshold": (0.50, 0.99, 0.95),
    "reentry_cooldown_minutes": (0, 480, 45),
    "account_capital": (100.0, 10_000_000.0, 1000.0),
    "min_volume_ratio": (0.0, 5.0, 0.5),
    "min_share_price": (0.0, 10_000.0, 20.0),
    "jev_timeout_sec": (0.5, 5.0, 2.0),
    "jev_max_retries": (0, 2, 1),
    "jev_samples": (1, 5, 1),
    "jev_spread_max_stddev": (0.0, 1.0, 0.05),
    "max_quote_age_sec": (2, 30, 5),
    "confirmation_count": (1, 5, 2),
    "drawdown_max_frac": (0.01, 0.50, 0.10),
}

_GATE_FIELDS = frozenset({"buy_probability", "confidence"})

# Fields where env ceiling means min(db, ceiling) (upper bound only).
_CEILING_FIELDS = frozenset(_SAFE_RANGES.keys())

_logged_clamps: set[str] = set()


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "t", "yes", "on"}:
        return True
    if text in {"0", "false", "f", "no", "off"}:
        return False
    return default


def _env_ceiling(field: str) -> Optional[float]:
    raw = os.getenv(f"RISK_CEILING_{field.upper()}")
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        logger.warning("Invalid RISK_CEILING_%s=%r — ignoring", field.upper(), raw)
        return None


def _log_clamp(field: str, before: Any, after: Any) -> None:
    key = f"{field}:{before}->{after}"
    if key in _logged_clamps:
        return
    _logged_clamps.add(key)
    logger.warning(
        "Risk sanitize clamped %s from %s to %s (safe range / env ceiling)",
        field,
        before,
        after,
    )


def clamp_numeric(field: str, value: Any) -> float:
    """Clamp a numeric order-affecting field to safe range then env ceiling."""
    lo, hi, default = _SAFE_RANGES[field]
    parsed = _as_float(value, default)
    before = parsed
    if parsed < lo or parsed > hi:
        parsed = min(max(parsed, lo), hi)
        if parsed != before:
            _log_clamp(field, before, parsed)
    ceiling = _env_ceiling(field)
    if ceiling is not None and parsed > ceiling:
        _log_clamp(field, parsed, ceiling)
        parsed = ceiling
    return parsed


def sanitize_gate_field(value: Any) -> str:
    text = str(value or "buy_probability").strip().lower()
    if text not in _GATE_FIELDS:
        _log_clamp("jev_gate_field", value, "buy_probability")
        return "buy_probability"
    return text


def sanitize_model_pin(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def sanitize_phase7_fields(data: Mapping[str, Any]) -> Dict[str, Any]:
    """Return sanitized Phase 7 Jev settings (and tightened timeout/retries)."""
    return {
        "jev_timeout_sec": clamp_numeric("jev_timeout_sec", data.get("jev_timeout_sec", 2)),
        "jev_max_retries": int(
            clamp_numeric("jev_max_retries", data.get("jev_max_retries", 1))
        ),
        "jev_gate_field": sanitize_gate_field(data.get("jev_gate_field")),
        "jev_model_pin": sanitize_model_pin(data.get("jev_model_pin")),
        "jev_samples": int(clamp_numeric("jev_samples", data.get("jev_samples", 1))),
        "jev_spread_veto_enabled": _as_bool(
            data.get("jev_spread_veto_enabled"), False
        ),
        "jev_spread_max_stddev": clamp_numeric(
            "jev_spread_max_stddev", data.get("jev_spread_max_stddev", 0.05)
        ),
    }


def apply_order_affecting_ceilings(
    data: MutableMapping[str, Any],
) -> MutableMapping[str, Any]:
    """Clamp known order-affecting numerics already present on the settings dict."""
    for field in _CEILING_FIELDS:
        if field not in data:
            continue
        lo, hi, default = _SAFE_RANGES[field]
        # Integer-ish fields
        if field in {
            "max_open_positions",
            "jev_max_retries",
            "jev_samples",
            "max_quote_age_sec",
            "confirmation_count",
            "max_hold_minutes",
            "min_hold_minutes",
            "reentry_cooldown_minutes",
        }:
            data[field] = int(clamp_numeric(field, data.get(field, default)))
        else:
            data[field] = clamp_numeric(field, data.get(field, default))
    return data
