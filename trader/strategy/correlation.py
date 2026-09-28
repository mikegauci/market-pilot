from __future__ import annotations

from typing import Dict, Iterable, Set

# Symbols in the same bucket tend to move together (mega-cap / tech).
CORRELATION_GROUPS: Dict[str, Set[str]] = {
    "mega_cap_tech": {
        "NVDA",
        "META",
        "GOOGL",
        "AAPL",
        "MSFT",
        "AMD",
        "AMZN",
        "TSLA",
        "QQQ",
    },
}


def correlation_group(symbol: str) -> str | None:
    for group_name, members in CORRELATION_GROUPS.items():
        if symbol in members:
            return group_name
    return None


def count_correlated_open(open_symbols: Iterable[str], candidate: str) -> int:
    group = correlation_group(candidate)
    if group is None:
        return 0
    members = CORRELATION_GROUPS[group]
    return sum(1 for sym in open_symbols if sym in members)
