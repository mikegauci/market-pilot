from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Generic, Optional, TypeVar

T = TypeVar("T")


@dataclass
class _CacheEntry(Generic[T]):
    value: T
    expires_at: float


class TtlCache(Generic[T]):
    """Simple in-memory TTL cache keyed by symbol."""

    def __init__(self, ttl_sec: float) -> None:
        self.ttl_sec = ttl_sec
        self._entries: Dict[str, _CacheEntry[T]] = {}

    def get(self, key: str) -> Optional[T]:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if time.monotonic() >= entry.expires_at:
            del self._entries[key]
            return None
        return entry.value

    def set(self, key: str, value: T, *, ttl_sec: Optional[float] = None) -> None:
        ttl = self.ttl_sec if ttl_sec is None else ttl_sec
        self._entries[key] = _CacheEntry(
            value=value,
            expires_at=time.monotonic() + ttl,
        )

    def is_stale(self, key: str) -> bool:
        return self.get(key) is None

class CooldownTracker:
    """Per-key cooldown after empty results or failed fetches."""

    def __init__(self, base_ttl_sec: float, *, max_ttl_sec: float = 600.0) -> None:
        self.base_ttl_sec = base_ttl_sec
        self.max_ttl_sec = max_ttl_sec
        self._until: Dict[str, float] = {}
        self._attempts: Dict[str, int] = {}

    def is_active(self, key: str) -> bool:
        until = self._until.get(key, 0.0)
        if time.monotonic() >= until:
            self._until.pop(key, None)
            return False
        return True

    def record(self, key: str, *, retry_after_sec: Optional[float] = None) -> None:
        attempts = self._attempts.get(key, 0) + 1
        self._attempts[key] = attempts
        if retry_after_sec is not None:
            delay = retry_after_sec
        else:
            delay = min(
                self.base_ttl_sec * (2 ** (attempts - 1)),
                self.max_ttl_sec,
            )
        self._until[key] = time.monotonic() + delay

    def clear(self, key: str) -> None:
        self._attempts.pop(key, None)
        self._until.pop(key, None)
