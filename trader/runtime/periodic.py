from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Callable, Iterator, Optional

logger = logging.getLogger(__name__)


@contextmanager
def periodic_callback(
    interval_sec: float,
    callback: Callable[[], None],
    *,
    name: str = "periodic-callback",
) -> Iterator[None]:
    """Run ``callback`` every ``interval_sec`` on a daemon thread until the block exits."""
    if interval_sec <= 0:
        yield
        return

    stop = threading.Event()

    def worker() -> None:
        while not stop.wait(interval_sec):
            try:
                callback()
            except Exception as exc:
                logger.warning("%s failed: %s", name, exc)

    thread = threading.Thread(target=worker, daemon=True, name=name)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=interval_sec + 2.0)
