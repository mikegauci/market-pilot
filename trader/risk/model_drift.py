"""Jev model-drift Telegram alerts (debounced once per UTC day)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Protocol, Set

logger = logging.getLogger(__name__)


class NotifierLike(Protocol):
    def send(self, message: str) -> None: ...


class ModelDriftTracker:
    """Alert when returned Jev model differs from the requested model."""

    def __init__(self) -> None:
        self._alerted_dates: Set[str] = set()

    def check(
        self,
        *,
        requested: str,
        returned: Optional[str],
        notifier: Optional[NotifierLike] = None,
    ) -> bool:
        """Return True if an alert was sent."""
        req = (requested or "").strip()
        got = (returned or "").strip()
        if not req or not got or req == got:
            return False
        today = datetime.now(timezone.utc).date().isoformat()
        if today in self._alerted_dates:
            return False
        self._alerted_dates.add(today)
        message = (
            f"Market Pilot Jev model drift: requested={req} returned={got}"
        )
        logger.warning(message)
        if notifier is not None:
            try:
                notifier.send(message)
            except Exception as exc:
                logger.warning("Model drift notify failed: %s", exc)
        return True
