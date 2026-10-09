from __future__ import annotations


def should_refresh(now_mono: float, last_sync_mono: float, interval_sec: float) -> bool:
    """True when a cached Supabase read should be refreshed."""
    return (now_mono - last_sync_mono) >= interval_sec


def compute_loop_sleep_sec(
    interval: float,
    elapsed: float,
    last_heartbeat_mono: float,
    now_mono: float,
    heartbeat_interval_sec: float,
    track_heartbeat: bool,
) -> float:
    """Sleep duration before the next loop; cap so overdue heartbeats run immediately."""
    sleep_for = max(0.0, interval - elapsed)
    if not track_heartbeat:
        return sleep_for
    next_heartbeat_in = heartbeat_interval_sec - (now_mono - last_heartbeat_mono)
    if next_heartbeat_in <= 0:
        return 0.0
    return min(sleep_for, next_heartbeat_in)


# A failed cycle never reaches the heartbeat, so the heartbeat cap above would return 0 and the
# loop would retry back-to-back against a database or broker that is already struggling.
# Back off 5s, 10s, 20s, then hold at 30s so the heartbeat gap stays short once it recovers.
CYCLE_ERROR_BACKOFF_SEC = 5.0
CYCLE_ERROR_BACKOFF_MAX_SEC = 30.0


def apply_error_backoff(sleep_for: float, consecutive_failures: int) -> float:
    """Never retry a failed cycle immediately; wait longer the more cycles fail in a row."""
    if consecutive_failures <= 0:
        return sleep_for
    backoff = min(
        CYCLE_ERROR_BACKOFF_SEC * 2 ** (consecutive_failures - 1),
        CYCLE_ERROR_BACKOFF_MAX_SEC,
    )
    return max(sleep_for, backoff)
