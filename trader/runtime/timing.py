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
