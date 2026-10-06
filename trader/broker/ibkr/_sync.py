from __future__ import annotations

from functools import wraps
from typing import Callable, TypeVar

F = TypeVar("F", bound=Callable[..., object])


def ibkr_synchronized(method: F) -> F:
    @wraps(method)
    def wrapper(self: "IBKRClient", *args: object, **kwargs: object) -> object:
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper  # type: ignore[return-value]


# Backward-compatible alias for in-module decorators
_ibkr_synchronized = ibkr_synchronized
