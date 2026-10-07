from __future__ import annotations

from typing import Literal, Optional

from models.types import MarketState

EntryEmaGate = Literal["off", "ema_9", "ema_20"]

_VALID: frozenset[str] = frozenset({"off", "ema_9", "ema_20"})


def normalize_entry_ema_gate(raw: object, *, default: EntryEmaGate = "ema_20") -> EntryEmaGate:
    if raw is None:
        return default
    value = str(raw).strip().lower()
    if value in _VALID:
        return value  # type: ignore[return-value]
    return default


def entry_ema_gate_from_require_flag(require_above_ema20: bool) -> EntryEmaGate:
    return "ema_20" if require_above_ema20 else "off"


def check_entry_ema_gate(
    state: MarketState,
    gate: EntryEmaGate,
) -> Optional[str]:
    """Return skip reason when the gate fails; None when passed or off."""
    if gate == "off":
        return None
    if gate == "ema_9":
        if state.ema_9 is None:
            return "ema_warming_up"
        if state.price <= state.ema_9:
            return "price_below_ema9"
        return None
    if state.ema_20 is None:
        return "ema_warming_up"
    if state.price <= state.ema_20:
        return "price_below_ema20"
    return None


def entry_ema_gate_blocks_rotation(
    *,
    price: Optional[float],
    ema_9: Optional[float],
    ema_20: Optional[float],
    gate: EntryEmaGate | str,
) -> bool:
    """True when rotation should exclude this symbol (same fail-closed rules as entry)."""
    normalized = normalize_entry_ema_gate(gate)
    if normalized == "off" or price is None:
        return normalized != "off" and price is None
    skip = check_entry_ema_gate(
        MarketState(
            symbol="",
            price=price,
            change_5m=None,
            change_15m=None,
            volume_ratio=None,
            rsi=None,
            ema_9=ema_9,
            ema_20=ema_20,
            bid=None,
            ask=None,
            spread=None,
            spy_change_5m=None,
        ),
        normalized,
    )
    return skip is not None
