"""Completed 1-minute trade bars: keepUpToDate seed + forward-fill + forming-bar drop."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence

from market.bar_aggregator import MinuteBar, _ensure_utc, _minute_bucket

logger = logging.getLogger(__name__)

# One-shot seed duration for newly ranked names (not a tunable setting).
BAR_1M_DURATION = "1 D"
BAR_SIZE_1M = "1 min"


def drop_forming_bar(
    bars: Sequence[MinuteBar],
    *,
    now: Optional[datetime] = None,
) -> List[MinuteBar]:
    """Drop the still-forming last bar (current UTC minute)."""
    if not bars:
        return []
    now_u = _ensure_utc(now or datetime.now(timezone.utc))
    current_bucket = _minute_bucket(now_u)
    completed = [b for b in bars if _ensure_utc(b.ts) < current_bucket]
    return completed


def forward_fill_zero_volume(
    bars: Sequence[MinuteBar],
    *,
    session_open: datetime,
    session_close: datetime,
    now: Optional[datetime] = None,
) -> List[MinuteBar]:
    """Insert flat zero-volume bars for missing RTH minutes up to last completed.

    Forward-filled bars have volume=0 and must not count as distinct confirmations
    (caller checks volume > 0 or a flag).
    """
    if not bars:
        return []

    now_u = _ensure_utc(now or datetime.now(timezone.utc))
    end = min(_minute_bucket(now_u), _ensure_utc(session_close))
    start = _minute_bucket(_ensure_utc(session_open))
    by_ts: Dict[datetime, MinuteBar] = {_ensure_utc(b.ts): b for b in bars}

    filled: List[MinuteBar] = []
    cursor = start
    last_close: Optional[float] = None
    while cursor < end:
        existing = by_ts.get(cursor)
        if existing is not None:
            filled.append(existing)
            last_close = existing.close
        elif last_close is not None:
            filled.append(
                MinuteBar(
                    ts=cursor,
                    open=last_close,
                    high=last_close,
                    low=last_close,
                    close=last_close,
                    volume=0,
                )
            )
        cursor += timedelta(minutes=1)
    return filled


def last_tradable_completed_bar(
    bars: Sequence[MinuteBar],
    *,
    now: Optional[datetime] = None,
) -> Optional[MinuteBar]:
    """Latest completed bar with real volume (skips forward-fill zeros)."""
    completed = drop_forming_bar(bars, now=now)
    for bar in reversed(completed):
        if bar.volume > 0:
            return bar
    return None


def bars_from_ib_historical(raw_bars: Iterable) -> List[MinuteBar]:
    """Convert ib_insync BarData rows to MinuteBar (UTC).

    Supports formatDate=1 (datetime) and formatDate=2 (epoch seconds).
    """
    out: List[MinuteBar] = []
    for row in raw_bars:
        ts = getattr(row, "date", None)
        if ts is None:
            continue
        if isinstance(ts, (int, float)):
            stamp = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        elif isinstance(ts, datetime):
            stamp = _ensure_utc(ts)
        else:
            text = str(ts).strip()
            try:
                if text.isdigit():
                    stamp = datetime.fromtimestamp(float(text), tz=timezone.utc)
                else:
                    stamp = _ensure_utc(datetime.fromisoformat(text.replace(" ", "T")))
            except ValueError:
                continue
        stamp = _minute_bucket(stamp)
        out.append(
            MinuteBar(
                ts=stamp,
                open=float(row.open),
                high=float(row.high),
                low=float(row.low),
                close=float(row.close),
                volume=int(getattr(row, "volume", 0) or 0),
            )
        )
    return out


def sync_trade_bars_into_store(
    minute_bars,
    symbol: str,
    raw_bars: Iterable,
    *,
    session_open: Optional[datetime] = None,
    session_close: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> Optional[MinuteBar]:
    """Drop forming bar, optional forward-fill, load into MinuteBarAggregator.

    Returns the latest real-volume completed bar (for confirmation), or None.
    """
    parsed = bars_from_ib_historical(raw_bars)
    completed = drop_forming_bar(parsed, now=now)
    if session_open is not None and session_close is not None and completed:
        completed = forward_fill_zero_volume(
            completed,
            session_open=session_open,
            session_close=session_close,
            now=now,
        )
    minute_bars.get(symbol).replace_completed_bars(completed)
    return last_tradable_completed_bar(completed, now=now)


def volume_units_match(seed_bars: Sequence[MinuteBar], live_bars: Sequence[MinuteBar]) -> bool:
    """True when overlapping minutes have volumes in the same order of magnitude.

    Guards against mixing share-count vs lot-size scaled feeds.
    """
    seed_map = {_ensure_utc(b.ts): b.volume for b in seed_bars if b.volume > 0}
    ratios: List[float] = []
    for bar in live_bars:
        if bar.volume <= 0:
            continue
        seed_vol = seed_map.get(_ensure_utc(bar.ts))
        if seed_vol is None or seed_vol <= 0:
            continue
        ratios.append(bar.volume / seed_vol)
    if not ratios:
        return True
    # Allow 10x tolerance for partial minutes / vendor quirks
    return all(0.1 <= r <= 10.0 for r in ratios)


def diff_live_vs_historical(
    live_bars: Sequence[MinuteBar],
    historical_bars: Sequence[MinuteBar],
    *,
    now: Optional[datetime] = None,
) -> dict:
    """Compare stored live completed bars to a one-shot historical re-fetch.

    Returns a summary dict suitable for logging (matched / mismatched / missing).
    """
    live = drop_forming_bar(live_bars, now=now)
    hist = drop_forming_bar(historical_bars, now=now)
    live_map = {_ensure_utc(b.ts): b for b in live if b.volume > 0}
    hist_map = {_ensure_utc(b.ts): b for b in hist if b.volume > 0}
    common = sorted(set(live_map) & set(hist_map))
    mismatched = 0
    close_err_sum = 0.0
    for ts in common:
        lb, hb = live_map[ts], hist_map[ts]
        if lb.close != hb.close or lb.volume != hb.volume:
            mismatched += 1
            if hb.close:
                close_err_sum += abs(lb.close - hb.close) / abs(hb.close)
    return {
        "live_bars": len(live_map),
        "historical_bars": len(hist_map),
        "common_minutes": len(common),
        "mismatched_minutes": mismatched,
        "missing_in_live": len(set(hist_map) - set(live_map)),
        "missing_in_historical": len(set(live_map) - set(hist_map)),
        "avg_close_abs_pct_err": (close_err_sum / mismatched) if mismatched else 0.0,
        "volume_units_ok": volume_units_match(hist, live),
    }
