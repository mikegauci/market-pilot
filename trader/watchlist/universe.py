from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from database.supabase import SupabaseRepository

logger = logging.getLogger(__name__)

MAX_UNIVERSE_SIZE = 80

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


def is_single_name_equity(symbol: str, name: str = "", instrument_type: str | None = None) -> bool:
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
) -> List[str]:
    """Load US-listed EM symbols from Supabase (preferred) or JSON fallback."""
    if db is not None:
        try:
            symbols = db.get_em_universe_symbols()
            if symbols:
                logger.debug("Loaded %s EM symbol(s) from Supabase em_universe", len(symbols))
                return symbols
            logger.info("em_universe table empty — falling back to JSON")
        except Exception as exc:
            logger.warning("Supabase em_universe unavailable (%s) — falling back to JSON", exc)

    universe_path = path or default_universe_path()
    return _load_em_universe_json(universe_path)
