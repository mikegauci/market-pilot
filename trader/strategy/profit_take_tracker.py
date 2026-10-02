from __future__ import annotations

from collections import deque
from typing import Deque, Dict, Set


class ProfitTakeBandTracker:
    """Count recent eval cycles where price progress was in the early TP band."""

    def __init__(self, window_cycles: int = 10) -> None:
        self.window_cycles = max(1, int(window_cycles))
        self._windows: Dict[str, Deque[bool]] = {}

    def reconfigure(self, window_cycles: int) -> None:
        self.window_cycles = max(1, int(window_cycles))

    def record(self, trade_id: str, in_band: bool) -> int:
        """Append one cycle sample; return band-hit count in the rolling window."""
        key = str(trade_id)
        window = self._windows.get(key)
        if window is None:
            window = deque(maxlen=self.window_cycles)
            self._windows[key] = window
        elif window.maxlen != self.window_cycles:
            window = deque(list(window)[-self.window_cycles :], maxlen=self.window_cycles)
            self._windows[key] = window
        window.append(in_band)
        return sum(1 for x in window if x)

    def clear(self, trade_id: str) -> None:
        self._windows.pop(str(trade_id), None)

    def prune(self, open_trade_ids: Set[str]) -> None:
        keep = {str(tid) for tid in open_trade_ids}
        for tid in list(self._windows):
            if tid not in keep:
                del self._windows[tid]
