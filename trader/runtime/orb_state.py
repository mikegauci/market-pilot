from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Set

from market.opening_range import InPlayMetrics, OpeningRange


@dataclass
class OrbDayState:
    """Per-trading-day opening range data. Resets itself when the US Eastern date changes."""

    day: str = ""
    ranges: Dict[str, OpeningRange] = field(default_factory=dict)
    metrics: Dict[str, InPlayMetrics] = field(default_factory=dict)
    # Symbols whose opening window came from an IBKR history request today (authoritative volume).
    history_done: Set[str] = field(default_factory=set)
    history_attempts: Dict[str, int] = field(default_factory=dict)
    selected: bool = False

    def reset_for(self, day: str) -> None:
        if self.day == day:
            return
        self.day = day
        self.ranges.clear()
        self.metrics.clear()
        self.history_done.clear()
        self.history_attempts.clear()
        self.selected = False
