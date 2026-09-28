from __future__ import annotations

import fcntl
import os
import sys
from pathlib import Path
from typing import TextIO

_LOCK_PATH = Path(__file__).resolve().parent / ".trader.lock"
_lock_file: TextIO | None = None


def acquire_trader_lock() -> None:
    """Ensure only one trader process runs at a time."""
    global _lock_file
    _lock_file = _LOCK_PATH.open("w")
    try:
        fcntl.flock(_lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(
            "\n*** TRADER ALREADY RUNNING ***\n"
            "Another market-pilot trader holds the process lock.\n"
            "Stop it before starting a new one:\n"
            "  pgrep -fl main.py\n"
            "  pkill -f \"python.*main.py\"\n",
            file=sys.stderr,
        )
        sys.exit(1)

    _lock_file.write(str(os.getpid()))
    _lock_file.flush()
