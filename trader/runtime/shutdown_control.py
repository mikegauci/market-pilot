from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional


# Keep in sync with dashboard/lib/trader-status.ts HEARTBEAT_STALE_SEC.
HEARTBEAT_STALE_SEC = 30


class StartupShutdownAction(str, Enum):
    START = "start"
    BLOCK_UNTIL_CANCEL = "block_until_cancel"
    EXIT_PENDING_STOP = "exit_pending_stop"


def _parse_heartbeat_iso(last_heartbeat: Optional[str]) -> Optional[datetime]:
    if not last_heartbeat:
        return None
    raw = last_heartbeat.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def heartbeat_age_sec(
    last_heartbeat: Optional[str],
    now: Optional[datetime] = None,
) -> Optional[float]:
    parsed = _parse_heartbeat_iso(last_heartbeat)
    if parsed is None:
        return None
    ref = now or datetime.now(timezone.utc)
    return max(0.0, (ref - parsed).total_seconds())


def is_heartbeat_fresh(
    last_heartbeat: Optional[str],
    now: Optional[datetime] = None,
) -> bool:
    age = heartbeat_age_sec(last_heartbeat, now=now)
    return age is not None and age <= HEARTBEAT_STALE_SEC


def resolve_startup_shutdown_action(
    shutdown_requested: bool,
    last_heartbeat: Optional[str],
    now: Optional[datetime] = None,
) -> StartupShutdownAction:
    """Decide how to handle bot_status.shutdown_requested when main.py starts."""
    if not shutdown_requested:
        return StartupShutdownAction.START
    if is_heartbeat_fresh(last_heartbeat, now=now):
        return StartupShutdownAction.EXIT_PENDING_STOP
    return StartupShutdownAction.BLOCK_UNTIL_CANCEL


def resolve_startup_entry_enabled(stored_enabled: bool) -> tuple[bool, bool]:
    """
    Whether to open new trades when main.py starts successfully.

    Returns (effective_enabled, resumed_from_offline_pause).
    """
    if stored_enabled:
        return True, False
    return True, True
