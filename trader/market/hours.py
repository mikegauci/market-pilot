"""US equity session clock (NYSE) with holiday / early-close awareness."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
logger = logging.getLogger(__name__)

_XNYS = None
_CALENDAR_ERROR: Optional[str] = None


@dataclass(frozen=True)
class SessionClock:
    """Snapshot of the regular US equity session relative to ``now``."""

    now: datetime
    is_open: bool
    session_open_at: Optional[datetime]
    session_close_at: Optional[datetime]
    minutes_to_close: Optional[float]
    error: Optional[str] = None

    @property
    def fail_closed(self) -> bool:
        """True when calendar is unusable — block new entries."""
        return self.error is not None


def _load_calendar():
    global _XNYS, _CALENDAR_ERROR
    if _XNYS is not None or _CALENDAR_ERROR is not None:
        return _XNYS
    try:
        import exchange_calendars as xcals

        _XNYS = xcals.get_calendar("XNYS")
        _CALENDAR_ERROR = None
        return _XNYS
    except Exception as exc:  # pragma: no cover - import/env failure
        _CALENDAR_ERROR = f"calendar_unavailable: {exc}"
        logger.error("NYSE calendar unavailable: %s", exc)
        return None


def reset_calendar_cache() -> None:
    """Test helper to clear the cached calendar / error."""
    global _XNYS, _CALENDAR_ERROR
    _XNYS = None
    _CALENDAR_ERROR = None


def _ensure_et(when: datetime) -> datetime:
    if when.tzinfo is None:
        return when.replace(tzinfo=ET)
    return when.astimezone(ET)


def get_session_clock(now: datetime | None = None) -> SessionClock:
    """Return session open/close and minutes_to_close. Fail closed on errors."""
    when = _ensure_et(now if now is not None else datetime.now(tz=ET))
    cal = _load_calendar()
    if cal is None:
        return SessionClock(
            now=when,
            is_open=False,
            session_open_at=None,
            session_close_at=None,
            minutes_to_close=None,
            error=_CALENDAR_ERROR or "calendar_unavailable",
        )

    try:
        # exchange_calendars uses tz-naive UTC timestamps for schedule lookups.
        ts = when
        if not cal.is_session(ts.date()):
            # Not a trading day — find next session for display, but closed now.
            try:
                next_session = cal.next_session(ts.date())
                open_ts = cal.session_open(next_session).tz_convert(ET).to_pydatetime()
                close_ts = cal.session_close(next_session).tz_convert(ET).to_pydatetime()
            except Exception:
                open_ts = None
                close_ts = None
            return SessionClock(
                now=when,
                is_open=False,
                session_open_at=open_ts,
                session_close_at=close_ts,
                minutes_to_close=None,
                error=None,
            )

        open_ts = cal.session_open(ts.date()).tz_convert(ET).to_pydatetime()
        close_ts = cal.session_close(ts.date()).tz_convert(ET).to_pydatetime()
        is_open = open_ts <= when < close_ts
        minutes_to_close: Optional[float]
        if when < close_ts:
            minutes_to_close = (close_ts - when).total_seconds() / 60.0
        else:
            minutes_to_close = None
        return SessionClock(
            now=when,
            is_open=is_open,
            session_open_at=open_ts,
            session_close_at=close_ts,
            minutes_to_close=minutes_to_close if when < close_ts else None,
            error=None,
        )
    except Exception as exc:
        logger.error("Session clock failed for %s: %s", when.isoformat(), exc)
        return SessionClock(
            now=when,
            is_open=False,
            session_open_at=None,
            session_close_at=None,
            minutes_to_close=None,
            error=f"calendar_error: {exc}",
        )


def is_us_regular_session_open(now: datetime | None = None) -> bool:
    """True during the current NYSE regular session (holiday/early-close aware)."""
    clock = get_session_clock(now)
    if clock.fail_closed:
        return False
    return clock.is_open


def seconds_until_next_open(now: datetime | None = None) -> float:
    """Seconds until the next regular session open (0 if already open)."""
    clock = get_session_clock(now)
    if clock.is_open:
        return 0.0
    if clock.session_open_at is not None and clock.session_open_at > clock.now:
        return (clock.session_open_at - clock.now).total_seconds()

    cal = _load_calendar()
    when = clock.now
    if cal is None:
        # Fallback: next weekday 9:30 ET (legacy behaviour when calendar missing).
        probe = when
        for _ in range(8):
            is_weekday = probe.weekday() < 5
            calendar_date = probe.date()
            if is_weekday:
                open_today = datetime(
                    calendar_date.year,
                    calendar_date.month,
                    calendar_date.day,
                    9,
                    30,
                    tzinfo=ET,
                )
                if when < open_today:
                    return (open_today - when).total_seconds()
            probe = datetime(
                calendar_date.year,
                calendar_date.month,
                calendar_date.day,
                tzinfo=ET,
            ) + timedelta(days=1)
        raise RuntimeError("Could not find next US market open within 8 days")

    try:
        next_session = cal.next_session(when.date())
        open_ts = cal.session_open(next_session).tz_convert(ET).to_pydatetime()
        return max(0.0, (open_ts - when).total_seconds())
    except Exception as exc:
        raise RuntimeError(f"Could not find next US market open: {exc}") from exc


def minutes_to_session_close(now: datetime | None = None) -> Optional[float]:
    """Minutes until today's session close, or None if closed / unknown."""
    return get_session_clock(now).minutes_to_close
