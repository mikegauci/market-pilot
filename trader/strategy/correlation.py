from __future__ import annotations

from typing import Dict, Iterable, Set

# EM single-name buckets — keep membership aligned with em_universe (ADR/stock only).
CORRELATION_GROUPS: Dict[str, Set[str]] = {
    "china_internet": {
        "PDD",
        "TME",
        "VIPS",
        "BABA",
        "JD",
        "BIDU",
        "NTES",
        "BILI",
        "BEKE",
        "ZTO",
    },
    "china_fintech": {
        "FUTU",
    },
    "china_consumer_travel": {
        "TAL",
        "YUMC",
        "EDU",
    },
    "china_ev_cleantech": {
        "LI",
        "NIO",
        "XPEV",
    },
    "latam_fintech": {
        "NU",
        "MELI",
    },
    "materials_mining": {
        "VALE",
        "GGB",
        "SBSW",
        "AU",
        "GOLD",
    },
    "latam_energy_telecom": {
        "PBR",
        "ITUB",
        "BBD",
        "AMX",
        "CX",
        "TV",
        "SBS",
    },
    "sea_tech": {
        "SE",
        "GRAB",
    },
    "asia_semiconductors": {
        "TSM",
        "UMC",
        "LPL",
    },
    "india_it_finance": {
        "INFY",
        "WIT",
        "HDB",
        "IBN",
    },
    "korea_financials": {
        "KB",
        "SHG",
    },
}

CHINA_FACTOR_GROUPS = frozenset(
    {
        "china_internet",
        "china_fintech",
        "china_consumer_travel",
        "china_ev_cleantech",
    }
)

CHINA_FACTOR_SYMBOLS: Set[str] = set()
for _group_name, _members in CORRELATION_GROUPS.items():
    if _group_name in CHINA_FACTOR_GROUPS:
        CHINA_FACTOR_SYMBOLS.update(_members)


def correlation_group(symbol: str) -> str | None:
    key = symbol.upper()
    for group_name, members in CORRELATION_GROUPS.items():
        if key in members:
            return group_name
    return None


def count_correlated_open(open_symbols: Iterable[str], candidate: str) -> int:
    group = correlation_group(candidate)
    if group is None:
        return 0
    members = CORRELATION_GROUPS[group]
    return sum(1 for sym in open_symbols if sym.upper() in members)


def count_china_factor_open(open_symbols: Iterable[str], candidate: str) -> int:
    """Names with China ADR exposure (across china_* groups)."""
    symbols = {str(sym).upper() for sym in open_symbols}
    candidate_key = candidate.upper()
    if candidate_key in CHINA_FACTOR_SYMBOLS:
        symbols.add(candidate_key)
    return sum(1 for sym in symbols if sym in CHINA_FACTOR_SYMBOLS)
