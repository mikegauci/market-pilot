from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Optional, Set

logger = logging.getLogger(__name__)


class ConfirmationTracker:
    """Require consecutive ELIGIBLE signals before opening a trade.

    Modes:
    - legacy: consecutive eval-loop successes (1 Hz spam possible)
    - distinct_bars: count only once per completed bar timestamp
    """

    def __init__(
        self,
        required_count: int = 2,
        *,
        mode: str = "distinct_bars",
    ) -> None:
        self.required_count = max(1, int(required_count))
        self.mode = mode if mode in {"legacy", "distinct_bars"} else "distinct_bars"
        self._counts: Dict[str, int] = {}
        self._last_bar_ts: Dict[str, datetime] = {}
        # Shadow legacy counts for divergence logging
        self._legacy_counts: Dict[str, int] = {}

    def configure(self, required_count: int, mode: str) -> None:
        self.required_count = max(1, int(required_count))
        self.mode = mode if mode in {"legacy", "distinct_bars"} else "distinct_bars"

    def reset(self, symbol: str) -> None:
        key = str(symbol).upper()
        self._counts[key] = 0
        self._legacy_counts[key] = 0
        self._last_bar_ts.pop(key, None)

    def reset_symbols_not_in(self, active: Set[str]) -> None:
        active_u = {str(s).upper() for s in active}
        for key in list(self._counts.keys()):
            if key not in active_u:
                self.reset(key)

    def progress(self, symbol: str) -> tuple[int, int]:
        return self._counts.get(str(symbol).upper(), 0), self.required_count

    def record(
        self,
        symbol: str,
        eligible: bool,
        *,
        completed_bar_ts: Optional[datetime] = None,
        missed_bar: bool = False,
    ) -> bool:
        """Record an evaluation. Returns True when confirmation_count is met.

        distinct_bars: only advances when completed_bar_ts is new vs last counted.
        Zero-volume forward-fill bars should pass completed_bar_ts=None or caller
        should skip calling record for them.
        """
        key = str(symbol).upper()

        # Shadow legacy always advances on eligible eval loops
        if eligible and not missed_bar:
            self._legacy_counts[key] = self._legacy_counts.get(key, 0) + 1
        else:
            self._legacy_counts[key] = 0

        if missed_bar or not eligible:
            self._counts[key] = 0
            self._last_bar_ts.pop(key, None)
            self._log_shadow(key)
            return False

        if self.mode == "legacy":
            self._counts[key] = self._counts.get(key, 0) + 1
            approved = self._counts[key] >= self.required_count
            self._log_shadow(key)
            return approved

        # distinct_bars
        if completed_bar_ts is None:
            # No new completed bar in this eval — do not advance or reset
            self._log_shadow(key)
            return self._counts.get(key, 0) >= self.required_count

        bar_ts = completed_bar_ts
        if bar_ts.tzinfo is None:
            bar_ts = bar_ts.replace(tzinfo=timezone.utc)

        last = self._last_bar_ts.get(key)
        if last is not None and bar_ts <= last:
            # Same or older bar — do not double-count
            self._log_shadow(key)
            return self._counts.get(key, 0) >= self.required_count

        self._last_bar_ts[key] = bar_ts
        self._counts[key] = self._counts.get(key, 0) + 1
        approved = self._counts[key] >= self.required_count
        self._log_shadow(key)
        return approved

    def _log_shadow(self, key: str) -> None:
        live = self._counts.get(key, 0) >= self.required_count
        legacy = self._legacy_counts.get(key, 0) >= self.required_count
        if live != legacy:
            logger.info(
                "Confirmation shadow divergence %s: mode=%s live=%s/%s legacy=%s/%s",
                key,
                self.mode,
                self._counts.get(key, 0),
                self.required_count,
                self._legacy_counts.get(key, 0),
                self.required_count,
            )
