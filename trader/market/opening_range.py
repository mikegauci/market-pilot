"""Opening range and "stocks in play" metrics from stored 5-minute bars (US RTH).

The opening range is the high/low/volume of the first ``range_minutes`` after 9:30 ET.
Relative volume compares that window's volume with the same window on prior sessions;
gap % compares today's open with the previous session's last close. All values come
from one bar source (the 5-minute cache), so volume units always match.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

from market.bars import Bar
from market.hours import ET, MARKET_CLOSE_MINUTES, MARKET_OPEN_MINUTES, trading_calendar_date

MAX_BASELINE_DAYS = 5
MIN_BASELINE_DAYS = 2
BAR_MINUTES = 5


@dataclass(frozen=True)
class OpeningRange:
    symbol: str
    high: float
    low: float
    open: float
    volume: float
    range_minutes: int

    @property
    def size(self) -> float:
        return self.high - self.low


@dataclass(frozen=True)
class InPlayMetrics:
    rvol: Optional[float]
    gap_pct: Optional[float]
    baseline_days: int


def _to_et(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(ET)


def rth_bars_by_day(bars: Sequence[Bar]) -> Dict[str, List[Bar]]:
    """Group regular-session 5m bars by US Eastern date, oldest first."""
    days: Dict[str, List[Bar]] = {}
    for bar in sorted(bars, key=lambda item: item.ts):
        et = _to_et(bar.ts)
        minutes = et.hour * 60 + et.minute
        if not (MARKET_OPEN_MINUTES <= minutes < MARKET_CLOSE_MINUTES):
            continue
        days.setdefault(et.date().isoformat(), []).append(bar)
    return days


def _window_bars(day_bars: Sequence[Bar], range_minutes: int) -> Optional[List[Bar]]:
    """Bars covering [9:30, 9:30 + range_minutes) when every 5m bucket is present."""
    needed = max(1, range_minutes // BAR_MINUTES)
    by_offset: Dict[int, Bar] = {}
    for bar in day_bars:
        et = _to_et(bar.ts)
        offset = et.hour * 60 + et.minute - MARKET_OPEN_MINUTES
        if 0 <= offset < range_minutes and offset % BAR_MINUTES == 0:
            by_offset[offset] = bar
    if len(by_offset) < needed:
        return None
    return [by_offset[offset] for offset in sorted(by_offset)]


def opening_range_for_day(
    symbol: str,
    day_bars: Sequence[Bar],
    range_minutes: int,
) -> Optional[OpeningRange]:
    window = _window_bars(day_bars, range_minutes)
    if not window:
        return None
    return OpeningRange(
        symbol=symbol.upper(),
        high=max(float(bar.high) for bar in window),
        low=min(float(bar.low) for bar in window),
        open=float(window[0].open),
        volume=float(sum(bar.volume for bar in window)),
        range_minutes=range_minutes,
    )


def opening_range_today(
    symbol: str,
    bars: Sequence[Bar],
    range_minutes: int,
    *,
    now: Optional[datetime] = None,
) -> Optional[OpeningRange]:
    """Today's opening range, or None until the window has closed and all bars exist."""
    session_day = trading_calendar_date(now)
    current = _to_et(now) if now is not None else datetime.now(tz=ET)
    elapsed = current.hour * 60 + current.minute - MARKET_OPEN_MINUTES
    if current.date().isoformat() != session_day or elapsed < range_minutes:
        return None
    return opening_range_for_day(
        symbol,
        rth_bars_by_day(bars).get(session_day, []),
        range_minutes,
    )


def in_play_metrics(
    bars: Sequence[Bar],
    range_minutes: int,
    *,
    now: Optional[datetime] = None,
) -> InPlayMetrics:
    """Relative volume of today's opening window and gap % vs the previous close."""
    session_day = trading_calendar_date(now)
    days = rth_bars_by_day(bars)
    today_bars = days.get(session_day, [])
    prior_days = sorted(day for day in days if day < session_day)

    today_window = _window_bars(today_bars, range_minutes)
    today_volume = (
        float(sum(bar.volume for bar in today_window)) if today_window else None
    )

    baseline: List[float] = []
    for day in reversed(prior_days):
        window = _window_bars(days[day], range_minutes)
        if not window:
            continue
        volume = float(sum(bar.volume for bar in window))
        if volume > 0:
            baseline.append(volume)
        if len(baseline) >= MAX_BASELINE_DAYS:
            break

    rvol: Optional[float] = None
    if today_volume is not None and len(baseline) >= MIN_BASELINE_DAYS:
        average = sum(baseline) / len(baseline)
        if average > 0:
            rvol = round(today_volume / average, 3)

    gap_pct: Optional[float] = None
    if today_window and prior_days:
        prev_close = float(days[prior_days[-1]][-1].close)
        today_open = float(today_window[0].open)
        if prev_close > 0 and today_open > 0:
            gap_pct = round((today_open - prev_close) / prev_close * 100, 3)

    return InPlayMetrics(rvol=rvol, gap_pct=gap_pct, baseline_days=len(baseline))
