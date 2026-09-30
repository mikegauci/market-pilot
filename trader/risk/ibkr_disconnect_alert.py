"""Edge-triggered IBKR disconnect Telegram alerts."""

from __future__ import annotations

import time
from typing import Optional, Protocol


class NotifierLike(Protocol):
    def send(self, message: str) -> None: ...


class IbkrDisconnectAlertTracker:
    """Fire once when connected → disconnected; debounce repeats."""

    def __init__(self, *, min_gap_sec: float = 60.0) -> None:
        self.min_gap_sec = float(min_gap_sec)
        self._was_connected = False
        self._last_alert_mono = 0.0

    def observe(
        self,
        connected: bool,
        *,
        notifier: Optional[NotifierLike] = None,
        now_mono: Optional[float] = None,
    ) -> bool:
        """Return True if a disconnect alert was sent."""
        now = time.monotonic() if now_mono is None else float(now_mono)
        alerted = False
        if self._was_connected and not connected:
            if self._last_alert_mono <= 0 or (now - self._last_alert_mono) >= self.min_gap_sec:
                self._last_alert_mono = now
                alerted = True
                if notifier is not None:
                    notifier.send("Market Pilot IBKR disconnected")
        elif connected and not self._was_connected and self._last_alert_mono > 0:
            # Optional reconnect notice after a prior disconnect alert.
            if notifier is not None:
                notifier.send("Market Pilot IBKR reconnected")
        self._was_connected = bool(connected)
        return alerted
