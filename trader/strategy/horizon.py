"""Safe load / clamp of Phase 2 horizon and EOD settings."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

# Safe defaults when DB values are missing or invalid.
DEFAULTS = {
    "prediction_horizon_minutes": 15,
    "last_entry_cutoff_minutes_before_close": 40,
    "eod_closeout_enabled": True,
    "eod_closeout_minutes_before_close": 10,
    "eod_flat_verify_minutes_before_close": 5,
    "equity_divergence_alert_frac": 0.05,
}


def _as_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return default
    if parsed < lo or parsed > hi:
        return default
    return parsed


def _as_float(value: Any, default: float, lo: float, hi: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed < lo or parsed > hi:
        return default
    return parsed


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "t", "yes", "on"}:
        return True
    if text in {"0", "false", "f", "no", "off"}:
        return False
    return default


def sanitize_horizon_eod_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Return clamped Phase 2 fields; force EOD closeout ON (overnight unsupported)."""
    horizon = _as_int(
        data.get("prediction_horizon_minutes"),
        DEFAULTS["prediction_horizon_minutes"],
        1,
        480,
    )
    closeout_mins = _as_int(
        data.get("eod_closeout_minutes_before_close"),
        DEFAULTS["eod_closeout_minutes_before_close"],
        5,
        15,
    )
    flat_verify = _as_int(
        data.get("eod_flat_verify_minutes_before_close"),
        DEFAULTS["eod_flat_verify_minutes_before_close"],
        1,
        10,
    )
    if flat_verify >= closeout_mins:
        flat_verify = max(1, closeout_mins - 1)

    cutoff = _as_int(
        data.get("last_entry_cutoff_minutes_before_close"),
        DEFAULTS["last_entry_cutoff_minutes_before_close"],
        1,
        120,
    )
    if cutoff < closeout_mins:
        cutoff = closeout_mins

    eod_enabled = _as_bool(data.get("eod_closeout_enabled"), True)
    if not eod_enabled:
        logger.warning(
            "eod_closeout_enabled=false is unsupported without overnight holding; forcing ON"
        )
        eod_enabled = True

    frac = _as_float(
        data.get("equity_divergence_alert_frac"),
        DEFAULTS["equity_divergence_alert_frac"],
        0.01,
        0.50,
    )

    return {
        "prediction_horizon_minutes": horizon,
        "last_entry_cutoff_minutes_before_close": cutoff,
        "eod_closeout_enabled": eod_enabled,
        "eod_closeout_minutes_before_close": closeout_mins,
        "eod_flat_verify_minutes_before_close": flat_verify,
        "equity_divergence_alert_frac": frac,
    }


def validate_horizon_conflicts(
    *,
    prediction_horizon_minutes: int,
    min_hold_minutes: float,
    max_hold_minutes: float,
    last_entry_cutoff_minutes_before_close: int,
    eod_closeout_enabled: bool,
    eod_closeout_minutes_before_close: int,
    eod_flat_verify_minutes_before_close: int,
) -> Tuple[List[str], List[str]]:
    """Return (errors, warnings) for horizon / EOD settings."""
    errors: List[str] = []
    warnings: List[str] = []

    if not eod_closeout_enabled:
        errors.append(
            "End-of-day closeout must stay ON while overnight holding is not supported"
        )

    if last_entry_cutoff_minutes_before_close < eod_closeout_minutes_before_close:
        errors.append("Last-entry cutoff must be at or above EOD closeout minutes")

    if eod_flat_verify_minutes_before_close >= eod_closeout_minutes_before_close:
        errors.append("Flat-verify minutes must be less than EOD closeout minutes")

    if max_hold_minutes > 0 and min_hold_minutes > max_hold_minutes:
        errors.append("Min hold must be at or below max hold when max hold is on")

    if max_hold_minutes == 0:
        warnings.append("Max hold is off (unbounded) — positions rely on SL/TP and EOD closeout")

    if max_hold_minutes > 0 and max_hold_minutes > prediction_horizon_minutes:
        warnings.append(
            f"Max hold ({max_hold_minutes:g}m) is longer than prediction horizon "
            f"({prediction_horizon_minutes}m)"
        )

    closeout = eod_closeout_minutes_before_close
    cutoff = last_entry_cutoff_minutes_before_close
    if cutoff < closeout + float(min_hold_minutes):
        warnings.append(
            "Last-entry cutoff is shorter than closeout + min hold "
            f"({closeout}+{min_hold_minutes:g}={closeout + float(min_hold_minutes):g}m)"
        )
    if cutoff < closeout + prediction_horizon_minutes:
        warnings.append(
            "Last-entry cutoff is shorter than closeout + prediction horizon "
            f"({closeout}+{prediction_horizon_minutes}={closeout + prediction_horizon_minutes}m)"
        )

    return errors, warnings
