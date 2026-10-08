"""Seed 1-minute aggregators with real IBKR history so indicators are valid right away."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Dict, List, Optional, Sequence

from market.bar_aggregator import MinuteBarStore
from market.hours import is_us_regular_session_open, minutes_since_regular_open

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient

logger = logging.getLogger(__name__)

BAR_SIZE_MINUTE = "1 min"
SEED_DURATION = "2400 S"
SEED_RETRY_SEC = 300.0
MAX_SEED_GAP_MINUTES = 3


def _ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def seed_minute_history(
    ibkr: "IBKRClient",
    minute_bars: MinuteBarStore,
    symbols: Sequence[str],
    *,
    min_bars: int,
    attempts: Dict[str, float],
    now: Optional[datetime] = None,
    now_mono: Optional[float] = None,
) -> List[str]:
    """Fetch today's 1-min bars for symbols still short of ``min_bars`` live bars.

    Skips the first ``min_bars`` minutes of the session (IBKR has too little of
    today yet) and retries a symbol at most every ``SEED_RETRY_SEC`` to stay
    inside IBKR historical-data pacing.
    """
    now = _ensure_utc(now or datetime.now(timezone.utc))
    if not is_us_regular_session_open(now):
        return []
    if minutes_since_regular_open(now) < min_bars + 1:
        return []
    if not ibkr.is_connected():
        return []

    mono = time.monotonic() if now_mono is None else now_mono
    current_minute = now.replace(second=0, microsecond=0)
    seeded: List[str] = []
    for symbol in dict.fromkeys(str(s).strip().upper() for s in symbols if str(s).strip()):
        aggregator = minute_bars.get(symbol)
        if aggregator.live_bar_count() >= min_bars:
            continue
        last = attempts.get(symbol)
        if last is not None and mono - last < SEED_RETRY_SEC:
            continue
        attempts[symbol] = mono

        try:
            bars = ibkr.fetch_historical_bars(
                symbol,
                duration=SEED_DURATION,
                bar_size=BAR_SIZE_MINUTE,
            )
        except Exception as exc:
            logger.warning("1-min history fetch failed for %s: %s", symbol, exc)
            continue

        completed = sorted(
            (bar for bar in bars if _ensure_utc(bar.ts) < current_minute),
            key=lambda bar: bar.ts,
        )
        if len(completed) < min_bars:
            continue
        gap = (current_minute - _ensure_utc(completed[-1].ts)).total_seconds() / 60
        if gap > MAX_SEED_GAP_MINUTES:
            continue
        aggregator.bootstrap_from_minute_bars(completed)
        seeded.append(symbol)

    if seeded:
        logger.info("Seeded real 1-minute history from IBKR for: %s", ", ".join(seeded))
    return seeded
