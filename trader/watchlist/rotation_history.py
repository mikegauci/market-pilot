from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, List, Optional, Sequence

MAX_ROTATION_HISTORY = 30


def rotation_swap_history_entry(
    swapped_in: Sequence[str],
    swapped_out: Sequence[str],
) -> Optional[dict[str, Any]]:
    added = [symbol.upper() for symbol in swapped_in if symbol]
    removed = [symbol.upper() for symbol in swapped_out if symbol]
    if not added and not removed:
        return None
    entry: dict[str, Any] = {
        "at": datetime.now(timezone.utc).isoformat(),
    }
    if added:
        entry["added"] = added
    if removed:
        entry["removed"] = removed
    return entry


def rotation_detail_history_entry(detail: str) -> dict[str, Any]:
    return {
        "at": datetime.now(timezone.utc).isoformat(),
        "detail": detail.strip()[:240],
    }


def prepend_rotation_history(
    existing: Any,
    entry: dict[str, Any],
) -> List[dict[str, Any]]:
    history: List[dict[str, Any]] = []
    if isinstance(existing, list):
        for item in existing:
            if isinstance(item, dict) and item.get("at"):
                history.append(item)
    return [entry, *history][:MAX_ROTATION_HISTORY]
