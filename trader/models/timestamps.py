"""Timestamp parsing shared by the repository and runtime (no heavy imports)."""
from __future__ import annotations

import re
from datetime import datetime, timezone

_ISO_FRACTION = re.compile(r"\.(\d+)([+-])")


def normalize_iso_timestamp(text: str) -> str:
    """Pad or trim fractional seconds to 6 digits so Python 3.9 ``fromisoformat`` accepts Postgres output."""
    text = text.replace("Z", "+00:00")

    def repl(match: re.Match[str]) -> str:
        frac = match.group(1)
        tz_sep = match.group(2)
        return f".{frac[:6]:0<6}{tz_sep}"

    return _ISO_FRACTION.sub(repl, text, count=1)


def parse_iso_timestamp(value: object) -> datetime:
    """Parse a DB timestamp (or pass through a datetime); naive values are treated as UTC. Raises ValueError."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(normalize_iso_timestamp(str(value)))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
