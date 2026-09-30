"""EM trading universe: US-listed ADR/stock of EEM/IEMG underlying issuers.

Policy (Phase 12): the universe contains **US listings** of emerging-market
underlying companies (ADRs and USD-listed stocks), **not** home-market local
shares. Broad EM/country ETFs are excluded. Duplicate issuer exposure is removed
by keeping a single primary listing per ``issuer_key``.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Sequence

if TYPE_CHECKING:
    from database.supabase import SupabaseRepository

logger = logging.getLogger(__name__)

MAX_UNIVERSE_SIZE = 80
LISTING_CLASS_US_LISTED = "us_listed_underlying"

# Broad EM / country basket ETFs — never treat as single-name scan/trade targets.
KNOWN_EM_ETF_SYMBOLS = frozenset(
    {
        "EEM",
        "VWO",
        "IEMG",
        "SCHE",
        "EMXC",
        "FXI",
        "MCHI",
        "KWEB",
        "INDA",
        "EPI",
        "EWZ",
        "EWY",
        "EWJ",
        "EWT",
        "EWH",
        "EWS",
        "EIDO",
        "EPHE",
        "THD",
        "EWW",
        "ECH",
        "ARGT",
        "AAXJ",
        "EEMA",
        "FEM",
        "GEM",
        "DGS",
        "SPEM",
    }
)

_ETF_NAME_RE = re.compile(r"\bETF\b|EXCHANGE[\s-]?TRADED", re.IGNORECASE)
_ISSUER_STRIP_RE = re.compile(
    r"\b("
    r"ADR|ADS|GDR|ORDINARY|ORD|CLASS\s+[A-Z]|CL\s+[A-Z]|"
    r"AMERICAN\s+DEPOSIT(?:ARY|ORY)?\s+(?:SHARES?|RECEIPTS?)|"
    r"DEPOSIT(?:ARY|ORY)\s+(?:SHARES?|RECEIPTS?)|"
    r"SPONSORED|UNSPONSORED|COMMON\s+STOCK|ORD\s+SHS"
    r")\b",
    re.IGNORECASE,
)
_NON_ALNUM_RE = re.compile(r"[^A-Z0-9]+")


def infer_instrument_type(symbol: str, name: str = "") -> str:
    """Classify ADR / stock / etf for universe hygiene."""
    key = symbol.strip().upper()
    if key in KNOWN_EM_ETF_SYMBOLS or _ETF_NAME_RE.search(name or ""):
        return "etf"
    upper_name = (name or "").upper()
    if any(
        token in upper_name
        for token in (
            "ADR",
            "ADS",
            "AMERICAN DEPOSIT",
            "DEPOSITARY",
            "DEPOSITORY",
            "GDR",
        )
    ):
        return "adr"
    return "stock"


def normalize_issuer_key(name: str, symbol: str = "") -> str:
    """Normalize company name into an issuer key for duplicate-listing dedupe."""
    cleaned = _ISSUER_STRIP_RE.sub(" ", name or "")
    cleaned = _NON_ALNUM_RE.sub(" ", cleaned.upper()).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if cleaned:
        return cleaned
    return (symbol or "").strip().upper()


def _instrument_rank(instrument_type: str | None) -> int:
    kind = (instrument_type or "stock").lower()
    if kind == "adr":
        return 0
    if kind == "stock":
        return 1
    return 2


def dedupe_by_issuer(
    rows: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Keep one primary US listing per issuer.

    Prefer highest ``weight_bps`` (or ``weight``), then ADR over stock, then
    lexicographic symbol.
    """
    best: Dict[str, Dict[str, Any]] = {}
    for raw in rows:
        row = dict(raw)
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        name = str(row.get("name", "") or "")
        issuer = str(row.get("issuer_key") or "").strip()
        if not issuer:
            issuer = normalize_issuer_key(name, symbol)
        row["symbol"] = symbol
        row["issuer_key"] = issuer
        row.setdefault(
            "instrument_type",
            infer_instrument_type(symbol, name),
        )
        weight = row.get("weight_bps")
        if weight is None:
            weight = float(row.get("weight", 0) or 0) * 100
        weight_bps = int(round(float(weight)))
        row["weight_bps"] = weight_bps

        existing = best.get(issuer)
        if existing is None:
            best[issuer] = row
            continue
        existing_weight = int(existing.get("weight_bps", 0) or 0)
        if weight_bps > existing_weight:
            best[issuer] = row
            continue
        if weight_bps < existing_weight:
            continue
        cur_rank = _instrument_rank(row.get("instrument_type"))
        ex_rank = _instrument_rank(existing.get("instrument_type"))
        if cur_rank < ex_rank:
            best[issuer] = row
            continue
        if cur_rank == ex_rank and symbol < str(existing.get("symbol", "")):
            best[issuer] = row

    return sorted(
        best.values(),
        key=lambda r: (-int(r.get("weight_bps", 0) or 0), str(r.get("symbol", ""))),
    )


def is_single_name_equity(
    symbol: str,
    name: str = "",
    instrument_type: str | None = None,
) -> bool:
    """True when the symbol is an ADR/stock suitable for dynamic ranking."""
    kind = (instrument_type or infer_instrument_type(symbol, name)).lower()
    return kind in {"adr", "stock"}


def default_universe_path() -> Path:
    trader_root = Path(__file__).resolve().parent.parent
    return trader_root.parent / "dashboard" / "data" / "em-us-listed.json"


def _load_em_universe_json(path: Path) -> List[str]:
    if not path.is_file():
        raise FileNotFoundError(f"EM universe file not found: {path}")

    raw = json.loads(path.read_text(encoding="utf-8"))
    symbols: List[str] = []
    for entry in raw:
        if isinstance(entry, str):
            symbol = entry.strip().upper()
            name = ""
            instrument_type = None
        elif isinstance(entry, dict):
            symbol = str(entry.get("symbol", "")).strip().upper()
            name = str(entry.get("name", "") or "")
            raw_type = entry.get("instrument_type")
            instrument_type = str(raw_type).strip().lower() if raw_type else None
        else:
            continue
        if not symbol:
            continue
        if not is_single_name_equity(symbol, name, instrument_type):
            continue
        if symbol not in symbols:
            symbols.append(symbol)

    if not symbols:
        raise ValueError(f"No symbols in EM universe: {path}")
    if len(symbols) > MAX_UNIVERSE_SIZE:
        symbols = symbols[:MAX_UNIVERSE_SIZE]
    return symbols


def load_em_universe(
    db: Optional["SupabaseRepository"] = None,
    path: Path | None = None,
    *,
    tradable_only: bool = True,
) -> List[str]:
    """Load US-listed EM symbols from Supabase (preferred) or JSON fallback."""
    if db is not None:
        try:
            symbols = db.get_em_universe_symbols(tradable_only=tradable_only)
            if symbols:
                logger.debug(
                    "Loaded %s EM symbol(s) from Supabase em_universe",
                    len(symbols),
                )
                return symbols
            logger.info("em_universe table empty — falling back to JSON")
        except Exception as exc:
            logger.warning(
                "Supabase em_universe unavailable (%s) — falling back to JSON",
                exc,
            )

    universe_path = path or default_universe_path()
    return _load_em_universe_json(universe_path)


def snapshot_payload_from_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize rows for ``em_universe_snapshots.symbols`` JSON."""
    out: List[Dict[str, Any]] = []
    for row in rows:
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        name = str(row.get("name", "") or "")
        out.append(
            {
                "symbol": symbol,
                "name": name,
                "weight_bps": int(row.get("weight_bps", 0) or 0),
                "instrument_type": row.get("instrument_type")
                or infer_instrument_type(symbol, name),
                "issuer_key": row.get("issuer_key")
                or normalize_issuer_key(name, symbol),
                "tradable": bool(row.get("tradable", True)),
                "country": row.get("country"),
                "exchange": row.get("exchange"),
                "currency": row.get("currency") or "USD",
                "ibkr_conid": row.get("ibkr_conid"),
                "listing_class": row.get("listing_class") or LISTING_CLASS_US_LISTED,
                "source_etfs": list(row.get("source_etfs") or []),
            }
        )
    return out
