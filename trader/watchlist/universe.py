from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from database.supabase import SupabaseRepository

logger = logging.getLogger(__name__)

MAX_UNIVERSE_SIZE = 80


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
        elif isinstance(entry, dict):
            symbol = str(entry.get("symbol", "")).strip().upper()
        else:
            continue
        if symbol and symbol not in symbols:
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
