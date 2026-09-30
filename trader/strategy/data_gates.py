"""Phase 3 data-quality gates and kill-switch helpers."""

from __future__ import annotations

import logging
import statistics
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)


def _ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def quote_age_sec(
    *,
    now: datetime,
    received_at: Optional[datetime],
    exchange_at: Optional[datetime] = None,
) -> Optional[float]:
    """Age in seconds. Prefer exchange_at only when explicitly provided as exchange time.

    Note: IBKR ticker.time is often local arrival time — callers must not pass it as
    exchange_at unless verified. Default path uses received_at only.
    """
    stamp = received_at
    if exchange_at is not None:
        stamp = exchange_at
    if stamp is None:
        return None
    return max(0.0, (_ensure_utc(now) - _ensure_utc(stamp)).total_seconds())


def quote_age_percentiles(ages: Sequence[float]) -> Tuple[Optional[float], Optional[float]]:
    if not ages:
        return None, None
    ordered = sorted(ages)
    if len(ordered) == 1:
        return ordered[0], ordered[0]
    return float(statistics.median(ordered)), float(
        statistics.quantiles(ordered, n=20)[18] if len(ordered) >= 20 else ordered[-1]
    )


@dataclass
class GateResult:
    passed: bool
    reason: str = ""


def check_quote_fresh_for_symbol(
    age_sec: Optional[float],
    max_quote_age_sec: float,
    *,
    enforce: bool,
) -> GateResult:
    if age_sec is None:
        return GateResult(False, "missing_quote_timestamp") if enforce else GateResult(True)
    if age_sec > max_quote_age_sec:
        return GateResult(False, "stale_quote") if enforce else GateResult(True)
    return GateResult(True)


def feed_stale_share(ages: Sequence[Optional[float]], kill_stale_quote_sec: float) -> float:
    if not ages:
        return 1.0
    stale = sum(1 for a in ages if a is None or a > kill_stale_quote_sec)
    return stale / len(ages)


def check_price_drift(
    decision_price: float,
    fresh_price: float,
    max_drift_frac: float,
) -> GateResult:
    if decision_price <= 0 or fresh_price <= 0:
        return GateResult(False, "invalid_price")
    drift = abs(fresh_price - decision_price) / decision_price
    if drift > max_drift_frac:
        return GateResult(False, "price_drift")
    return GateResult(True)


def check_signal_age(
    prediction_ts: Optional[datetime],
    *,
    now: datetime,
    max_signal_age_sec: float,
) -> GateResult:
    if prediction_ts is None:
        return GateResult(False, "missing_signal_timestamp")
    age = (_ensure_utc(now) - _ensure_utc(prediction_ts)).total_seconds()
    if age > max_signal_age_sec:
        return GateResult(False, "stale_signal")
    return GateResult(True)


def filter_news_for_jev_context(
    articles: Sequence[dict],
    *,
    now: datetime,
    max_pub_age_sec: float,
    max_receipt_lag_sec: float,
) -> Tuple[List[dict], List[dict]]:
    """Return (fresh_for_context, stale_negatives_for_veto).

    Stale articles are dropped from Jev context. Stale negatives are returned
    separately so callers can still veto; stale positives are discarded.
    """
    fresh: List[dict] = []
    stale_negatives: List[dict] = []
    now_u = _ensure_utc(now)

    for article in articles:
        published = article.get("published_at")
        fetched = article.get("fetched_at")
        if isinstance(published, str):
            try:
                published = datetime.fromisoformat(published.replace("Z", "+00:00"))
            except ValueError:
                published = None
        if isinstance(fetched, str):
            try:
                fetched = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
            except ValueError:
                fetched = None

        is_stale = False
        if published is not None:
            pub = _ensure_utc(published)
            if (now_u - pub).total_seconds() > max_pub_age_sec:
                is_stale = True
            if fetched is not None:
                lag = (_ensure_utc(fetched) - pub).total_seconds()
                if lag > max_receipt_lag_sec:
                    is_stale = True

        sentiment = article.get("sentiment")
        tags = [str(t).lower() for t in (article.get("tags") or [])]
        negative_tags = {
            "downgrade",
            "lawsuit",
            "sec_investigation",
            "guidance_cut",
            "earnings_miss",
            "layoffs",
        }
        is_negative = (isinstance(sentiment, (int, float)) and sentiment < 0) or bool(
            set(tags) & negative_tags
        )

        if is_stale:
            if is_negative:
                stale_negatives.append(article)
            continue
        fresh.append(article)

    return fresh, stale_negatives


@dataclass
class EntryKillSwitch:
    """Feed-level entry kill with time-based recovery and alert dedupe."""

    active: bool = True
    reason: str = "startup"
    activated_at: Optional[datetime] = None
    healthy_since: Optional[datetime] = None
    last_alert_at: Optional[datetime] = None
    _ages_log: Deque[float] = field(default_factory=lambda: deque(maxlen=500))

    def note_ages(self, ages: Iterable[float]) -> None:
        for age in ages:
            self._ages_log.append(float(age))

    def age_percentiles(self) -> Tuple[Optional[float], Optional[float]]:
        return quote_age_percentiles(list(self._ages_log))

    def should_alert(self, now: datetime, min_gap_sec: float) -> bool:
        if self.last_alert_at is None:
            return True
        return (_ensure_utc(now) - _ensure_utc(self.last_alert_at)).total_seconds() >= min_gap_sec

    def mark_alerted(self, now: datetime) -> None:
        self.last_alert_at = _ensure_utc(now)

    def activate(self, reason: str, now: datetime) -> bool:
        """Activate kill. Returns True if state changed."""
        now_u = _ensure_utc(now)
        if self.active and self.reason == reason:
            self.healthy_since = None
            return False
        changed = not self.active or self.reason != reason
        self.active = True
        self.reason = reason
        self.activated_at = now_u
        self.healthy_since = None
        return changed

    def observe_healthy(self, now: datetime, recover_sec: float) -> bool:
        """Call when gates are green. Returns True if kill cleared."""
        if not self.active:
            return False
        now_u = _ensure_utc(now)
        if self.healthy_since is None:
            self.healthy_since = now_u
            return False
        if (now_u - self.healthy_since).total_seconds() >= recover_sec:
            self.active = False
            self.reason = ""
            self.activated_at = None
            self.healthy_since = None
            return True
        return False

    def observe_unhealthy(self) -> None:
        self.healthy_since = None


@dataclass
class JevTransportKillTracker:
    """Rolling transport/auth/billing failure rate — not parse errors."""

    window_sec: float = 60.0
    kill_frac: float = 0.5
    _events: Deque[Tuple[float, bool]] = field(default_factory=deque)

    def record(self, *, transport_failure: bool, now: Optional[datetime] = None) -> None:
        ts = (_ensure_utc(now or datetime.now(timezone.utc))).timestamp()
        self._events.append((ts, transport_failure))
        self._trim(ts)

    def _trim(self, now_ts: float) -> None:
        cutoff = now_ts - self.window_sec
        while self._events and self._events[0][0] < cutoff:
            self._events.popleft()

    def failure_rate(self, now: Optional[datetime] = None) -> float:
        ts = (_ensure_utc(now or datetime.now(timezone.utc))).timestamp()
        self._trim(ts)
        if not self._events:
            return 0.0
        fails = sum(1 for _, failed in self._events if failed)
        return fails / len(self._events)

    def should_kill(self, now: Optional[datetime] = None) -> bool:
        # Need a minimum sample so a single failure doesn't trip.
        ts = (_ensure_utc(now or datetime.now(timezone.utc))).timestamp()
        self._trim(ts)
        if len(self._events) < 3:
            return False
        return self.failure_rate(now) >= self.kill_frac


def classify_jev_error(exc: BaseException) -> str:
    """Return 'transport' | 'parse' | 'other' for kill accounting."""
    import httpx

    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError, TimeoutError)):
        return "transport"
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in {401, 403, 402, 429} or code >= 500:
            return "transport"
        if code in {422, 400}:
            return "parse"
    msg = str(exc).lower()
    if "timeout" in msg or "connect" in msg or "rate" in msg:
        return "transport"
    if "parse" in msg or "probabilities" in msg or "json" in msg:
        return "parse"
    if isinstance(exc, RuntimeError) and "failed after" in msg:
        return "transport"
    return "other"
