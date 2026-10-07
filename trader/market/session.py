"""Intraday session metrics from live 1-minute bars (US RTH)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional, Sequence, TYPE_CHECKING

from market.bar_aggregator import MinuteBar, MinuteBarAggregator
from market.hours import ET, MARKET_CLOSE_MINUTES, MARKET_OPEN_MINUTES, trading_calendar_date

if TYPE_CHECKING:
    from market.bars import Bar

SESSION_DISQUALIFIED_SCORE = -1e9


def _coerce_et(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=ET)
    return ts.astimezone(ET)


def _is_rth_minute(ts_et: datetime, session_day: str) -> bool:
    if ts_et.date().isoformat() != session_day:
        return False
    minutes = ts_et.hour * 60 + ts_et.minute
    return MARKET_OPEN_MINUTES <= minutes < MARKET_CLOSE_MINUTES


def rth_session_open_from_five_min_bars(
    bars: Sequence["Bar"],
    *,
    now: Optional[datetime] = None,
) -> Optional[float]:
    """Official RTH open from cached 5m bars (stable across trader restarts)."""
    session_day = trading_calendar_date(now)
    first_open: Optional[float] = None
    first_ts: Optional[datetime] = None
    for bar in bars:
        ts_et = _coerce_et(bar.ts)
        if not _is_rth_minute(ts_et, session_day):
            continue
        if first_ts is None or ts_et < first_ts:
            first_ts = ts_et
            first_open = float(bar.open)
    if first_open is None or first_open <= 0:
        return None
    return first_open


def session_bars_for_today(
    bars: Sequence[MinuteBar],
    *,
    now: Optional[datetime] = None,
    live_only: bool = True,
) -> list[MinuteBar]:
    """Minute bars for today's US regular session."""
    session_day = trading_calendar_date(now)
    out: list[MinuteBar] = []
    for bar in bars:
        if live_only and bar.synthetic:
            continue
        if _is_rth_minute(_coerce_et(bar.ts), session_day):
            out.append(bar)
    out.sort(key=lambda item: _coerce_et(item.ts))
    return out


def session_change_pct_from_open(
    session_open: float,
    live_price: Optional[float],
) -> Optional[float]:
    if session_open <= 0 or live_price is None or live_price <= 0:
        return None
    return round((live_price - session_open) / session_open * 100, 4)


def session_change_pct_from_bars(
    bars: Sequence[MinuteBar],
    live_price: Optional[float],
    *,
    now: Optional[datetime] = None,
) -> Optional[float]:
    """Percent change from today's first RTH minute bar open to live_price."""
    session = session_bars_for_today(bars, now=now)
    if not session:
        return None
    open_px = session[0].open
    if open_px <= 0:
        return None
    if live_price is not None and live_price > 0:
        current = live_price
    else:
        current = session[-1].close
    return session_change_pct_from_open(open_px, current)


def session_change_pct_for_rotation(
    live_price: Optional[float],
    *,
    intraday_five_min_bars: Optional[Sequence["Bar"]] = None,
    minute_aggregator: Optional[MinuteBarAggregator] = None,
    now: Optional[datetime] = None,
) -> Optional[float]:
    """Prefer 5m cache for session open; fall back to live 1m bars."""
    if live_price is None or live_price <= 0:
        return None
    if intraday_five_min_bars:
        open_px = rth_session_open_from_five_min_bars(
            intraday_five_min_bars,
            now=now,
        )
        if open_px is not None:
            return session_change_pct_from_open(open_px, live_price)
    if minute_aggregator is not None:
        return session_change_pct_from_aggregator(minute_aggregator, live_price, now=now)
    return None


def session_change_pct_from_aggregator(
    aggregator: MinuteBarAggregator,
    live_price: Optional[float],
    *,
    now: Optional[datetime] = None,
) -> Optional[float]:
    bars = aggregator.live_minute_bars()
    if not bars:
        bars = [bar for bar in aggregator.all_bars() if not bar.synthetic]
    return session_change_pct_from_bars(bars, live_price, now=now)
