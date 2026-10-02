from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MARKET_OPEN_MINUTES = 9 * 60 + 30
MARKET_CLOSE_MINUTES = 16 * 60


def _coerce_et(when: datetime | None) -> datetime:
    if when is None:
        return datetime.now(tz=ET)
    if when.tzinfo is None:
        return when.replace(tzinfo=ET)
    return when.astimezone(ET)


def trading_calendar_date(when: datetime | None = None) -> str:
    """US Eastern calendar date (YYYY-MM-DD) for daily P&L boundaries."""
    return _coerce_et(when).date().isoformat()


def trading_day_start_utc(when: datetime | None = None) -> datetime:
    """Midnight US Eastern for the current trading calendar day, as UTC."""
    local = _coerce_et(when)
    midnight_et = datetime(
        local.year,
        local.month,
        local.day,
        tzinfo=ET,
    )
    return midnight_et.astimezone(timezone.utc)


def _et_parts(when: datetime) -> tuple[bool, int]:
    """Return (is_weekday, minutes_since_midnight) in US Eastern time."""
    local = when.astimezone(ET)
    is_weekday = local.weekday() < 5
    minutes = local.hour * 60 + local.minute
    return is_weekday, minutes


def is_us_regular_session_open(now: datetime | None = None) -> bool:
    """True during US regular session: Mon–Fri 9:30–16:00 America/New_York."""
    when = now if now is not None else datetime.now(tz=ET)
    if when.tzinfo is None:
        when = when.replace(tzinfo=ET)
    else:
        when = when.astimezone(ET)

    is_weekday, minutes = _et_parts(when)
    return (
        is_weekday
        and minutes >= MARKET_OPEN_MINUTES
        and minutes < MARKET_CLOSE_MINUTES
    )


def minutes_until_regular_close(now: datetime | None = None) -> float:
    """Minutes until 16:00 ET on a weekday session; negative after the close."""
    when = now if now is not None else datetime.now(tz=ET)
    if when.tzinfo is None:
        when = when.replace(tzinfo=ET)
    else:
        when = when.astimezone(ET)

    is_weekday, minutes = _et_parts(when)
    if not is_weekday:
        return -1.0
    remaining = MARKET_CLOSE_MINUTES - minutes
    if minutes < MARKET_OPEN_MINUTES:
        return float(MARKET_CLOSE_MINUTES - MARKET_OPEN_MINUTES)
    return float(remaining)


def is_entry_window_open(
    now: datetime | None = None,
    *,
    cutoff_minutes_before_close: float = 15.0,
) -> bool:
    if not is_us_regular_session_open(now):
        return False
    remaining = minutes_until_regular_close(now)
    return remaining > cutoff_minutes_before_close


def should_force_eod_flatten(
    now: datetime | None = None,
    *,
    flatten_minutes_before_close: float = 10.0,
) -> bool:
    if not is_us_regular_session_open(now):
        return False
    remaining = minutes_until_regular_close(now)
    return 0 < remaining <= flatten_minutes_before_close


def seconds_until_next_open(now: datetime | None = None) -> float:
    """Seconds until the next regular session open (0 if already open)."""
    when = now if now is not None else datetime.now(tz=ET)
    if when.tzinfo is None:
        when = when.replace(tzinfo=ET)
    else:
        when = when.astimezone(ET)

    if is_us_regular_session_open(when):
        return 0.0

    probe = when
    for _ in range(8):
        is_weekday, minutes = _et_parts(probe)
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
