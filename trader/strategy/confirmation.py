from __future__ import annotations

from typing import Dict


class ConfirmationTracker:
    """Require consecutive ELIGIBLE signals before opening a trade."""

    def __init__(self, required_cycles: int = 2) -> None:
        self.required_cycles = max(1, required_cycles)
        self._counts: Dict[str, int] = {}

    def record(self, symbol: str, eligible: bool) -> bool:
        if eligible:
            self._counts[symbol] = self._counts.get(symbol, 0) + 1
        else:
            self._counts[symbol] = 0
        return self._counts[symbol] >= self.required_cycles

    def progress(self, symbol: str) -> tuple[int, int]:
        return self._counts.get(symbol, 0), self.required_cycles

    def reset(self, symbol: str) -> None:
        self._counts[symbol] = 0
