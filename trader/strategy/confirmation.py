from __future__ import annotations

import time
from typing import Dict, Optional


class ConfirmationTracker:
    """Require ELIGIBLE signals sustained for a minimum duration before entry."""

    def __init__(
        self,
        required_cycles: int = 2,
        required_seconds: float = 30.0,
    ) -> None:
        self.required_cycles = max(1, required_cycles)
        self.required_seconds = max(0.0, float(required_seconds))
        self._first_eligible_mono: Dict[str, float] = {}
        self._counts: Dict[str, int] = {}

    def record(self, symbol: str, eligible: bool) -> bool:
        key = symbol.upper()
        now = time.monotonic()
        if not eligible:
            self._first_eligible_mono.pop(key, None)
            self._counts[key] = 0
            return False

        self._counts[key] = self._counts.get(key, 0) + 1
        if key not in self._first_eligible_mono:
            self._first_eligible_mono[key] = now

        if self.required_seconds <= 0:
            return self._counts[key] >= self.required_cycles

        elapsed = now - self._first_eligible_mono[key]
        cycle_ok = self._counts[key] >= self.required_cycles
        return cycle_ok and elapsed >= self.required_seconds

    def progress(self, symbol: str) -> tuple[int, int]:
        return self._counts.get(symbol.upper(), 0), self.required_cycles

    def seconds_remaining(self, symbol: str) -> Optional[float]:
        key = symbol.upper()
        started = self._first_eligible_mono.get(key)
        if started is None or self.required_seconds <= 0:
            return None
        remaining = self.required_seconds - (time.monotonic() - started)
        return max(0.0, remaining)

    def reset(self, symbol: str) -> None:
        key = symbol.upper()
        self._counts[key] = 0
        self._first_eligible_mono.pop(key, None)
