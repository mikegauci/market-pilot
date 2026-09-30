from __future__ import annotations

from typing import Dict, Iterable, Set

# EM single-name buckets — symbols in the same group tend to move together.
# Keep membership aligned with the live ADR/stock EM universe.
CORRELATION_GROUPS: Dict[str, Set[str]] = {
    "china_internet": {
        "PDD",
        "JOYY",
        "TME",
        "IQ",
        "VIPS",
        "ATHM",
        "MOMO",
        "VNET",
        "YMM",
        "BABA",
        "JD",
        "BIDU",
        "NTES",
        "BILI",
        "BEKE",
        "ZTO",
    },
    "china_fintech": {
        "QFIN",
        "FINV",
        "LU",
        "TIGR",
        "NOAH",
        "TUYA",
        "FUTU",
    },
    "china_consumer_travel": {
        "ATAT",
        "HTHT",
        "TAL",
        "RLX",
        "BZ",
        "YUMC",
        "EDU",
        "CYD",
    },
    "china_ev_cleantech": {
        "LI",
        "NIO",
        "XPEV",
        "DQ",
        "JKS",
        "LEGN",
    },
    "latam_fintech": {
        "NU",
        "XP",
        "STNE",
        "PAGS",
        "INTR",
        "PAX",
        "MELI",
    },
    "andean_financials": {
        "BAP",
        "IFS",
    },
    "materials_mining": {
        "BVN",
        "SCCO",
        "AUGO",
        "SGML",
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
        "JBS",
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
        "ASML",
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
    "japan_bluechips": {
        "MUFG",
        "SMFG",
        "SAP",
        "SONY",
        "TM",
    },
}


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
