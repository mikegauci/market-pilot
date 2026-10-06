from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class MarketTapeContext:
    sentiment: float
    tags: List[str]
    top_headline: str
    fetched_at: str


class MarketTapeStore:
    """Thread-safe cache of the latest broad-market tape score."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._context: Optional[MarketTapeContext] = None

    def get(self) -> Optional[MarketTapeContext]:
        with self._lock:
            return self._context

    def set(self, context: MarketTapeContext) -> None:
        with self._lock:
            self._context = context
