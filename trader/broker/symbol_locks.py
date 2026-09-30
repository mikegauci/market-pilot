"""Per-symbol locks for cancel-brackets + exit-sell critical sections."""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Dict, Iterator


class SymbolExitLocks:
    """Serialize exit operations per symbol (never oversell / race brackets)."""

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: Dict[str, threading.RLock] = {}

    def _lock_for(self, symbol: str) -> threading.RLock:
        key = str(symbol).upper()
        with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = threading.RLock()
                self._locks[key] = lock
            return lock

    @contextmanager
    def hold(self, symbol: str) -> Iterator[None]:
        lock = self._lock_for(symbol)
        lock.acquire()
        try:
            yield
        finally:
            lock.release()


# Process-wide coordinator used by EOD, signal exits, and manual close.
EXIT_LOCKS = SymbolExitLocks()
