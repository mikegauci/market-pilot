"""Execution cost and excursion helpers for Phase 6 logging."""

from __future__ import annotations

from typing import Optional, Tuple


def compute_long_slippage(
    *,
    decision_price: Optional[float],
    fill_price: float,
    quantity: float,
) -> float:
    """Signed $ slippage for a long: (fill - decision) * qty. 0 if no decision price."""
    if decision_price is None or decision_price <= 0 or quantity <= 0:
        return 0.0
    return (float(fill_price) - float(decision_price)) * float(quantity)


def update_excursions(
    *,
    entry_price: float,
    mark_price: float,
    mae: Optional[float],
    mfe: Optional[float],
) -> Tuple[float, float]:
    """Absolute $ per share excursions from entry: mae ≤ 0, mfe ≥ 0."""
    delta = float(mark_price) - float(entry_price)
    adverse = min(delta, 0.0)
    favorable = max(delta, 0.0)
    new_mae = adverse if mae is None else min(float(mae), adverse)
    new_mfe = favorable if mfe is None else max(float(mfe), favorable)
    return new_mae, new_mfe


def truncate_jev_raw(raw: Optional[dict], *, max_chars: int = 64_000) -> Optional[dict]:
    """Return raw dict or a truncated placeholder if too large when stringified."""
    if raw is None:
        return None
    import json

    try:
        text = json.dumps(raw, default=str)
    except Exception:
        return {"_truncated": True, "error": "unserializable"}
    if len(text) <= max_chars:
        return raw
    return {
        "_truncated": True,
        "model": raw.get("model"),
        "answers": raw.get("answers"),
        "original_chars": len(text),
    }
