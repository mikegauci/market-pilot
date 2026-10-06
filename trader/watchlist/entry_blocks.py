"""Manual entry blocks (dashboard) with timed return to the active list."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from models.types import RiskSettings
from watchlist.resolution import entry_blocked_symbol_set


def _parse_blocked_at(raw: object) -> Dict[str, datetime]:
    parsed: Dict[str, datetime] = {}
    if not isinstance(raw, dict):
        return parsed
    for key, value in raw.items():
        symbol = str(key).strip().upper()
        if not symbol or value is None:
            continue
        try:
            text = str(value).replace("Z", "+00:00")
            stamped = datetime.fromisoformat(text)
        except ValueError:
            continue
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=timezone.utc)
        parsed[symbol] = stamped
    return parsed


def entry_blocked_at_map(risk_settings: RiskSettings) -> Dict[str, datetime]:
    return _parse_blocked_at(getattr(risk_settings, "entry_blocked_at", None) or {})


def block_expiry_minutes(risk_settings: RiskSettings) -> int:
    return max(1, int(getattr(risk_settings, "watchlist_rotation_interval_minutes", 15) or 15))


def expired_entry_blocks(
    risk_settings: RiskSettings,
    *,
    now: Optional[datetime] = None,
) -> List[str]:
    """Symbols blocked longer than the rotation interval."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    cutoff = current - timedelta(minutes=block_expiry_minutes(risk_settings))
    blocked = entry_blocked_symbol_set(risk_settings)
    stamped = entry_blocked_at_map(risk_settings)
    expired: List[str] = []
    for symbol in blocked:
        at = stamped.get(symbol)
        if at is None or at <= cutoff:
            expired.append(symbol)
    return expired


def reactivate_expired_blocks(
    risk_settings: RiskSettings,
    expired: List[str],
) -> Tuple[RiskSettings, List[str], Optional[List[str]]]:
    """Remove expired blocks and prepend symbols to the active list when rotating."""
    from dataclasses import replace

    if not expired:
        return risk_settings, [], None

    expired_set = {symbol.upper() for symbol in expired}
    remaining = [
        symbol
        for symbol in risk_settings.entry_blocked_symbols
        if symbol.upper() not in expired_set
    ]
    at_map = entry_blocked_at_map(risk_settings)
    for symbol in expired_set:
        at_map.pop(symbol, None)

    next_active: Optional[List[str]] = None
    updated = risk_settings
    if risk_settings.watchlist_rotation_enabled and risk_settings.watchlist_pool:
        active = [
            symbol
            for symbol in risk_settings.watchlist_active
            if symbol.upper() not in expired_set
        ]
        for symbol in expired:
            key = symbol.upper()
            active = [s for s in active if s.upper() != key]
            active.insert(0, key)
        size = max(1, int(risk_settings.watchlist_active_size))
        while len(active) > size:
            active.pop()
        next_active = active
        updated = replace(risk_settings, watchlist_active=active)

    updated = replace(
        updated,
        entry_blocked_symbols=remaining,
        entry_blocked_at={
            symbol: at.isoformat()
            for symbol, at in at_map.items()
        },
    )
    return updated, remaining, next_active


def apply_expired_entry_blocks(
    risk_settings: RiskSettings,
    *,
    now: Optional[datetime] = None,
) -> Tuple[RiskSettings, List[str]]:
    """Drop stale blocks and return symbols restored to the active list."""
    expired = expired_entry_blocks(risk_settings, now=now)
    updated, _, next_active = reactivate_expired_blocks(risk_settings, expired)
    if not expired:
        return risk_settings, []
    return updated, expired
