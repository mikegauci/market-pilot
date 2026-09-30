from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from watchlist.universe import (
    MAX_UNIVERSE_SIZE,
    infer_instrument_type,
    load_em_universe,
)


class UniverseLoaderTests(unittest.TestCase):
    def test_prefers_supabase_when_available(self) -> None:
        db = MagicMock()
        db.get_em_universe_symbols.return_value = ["NU", "PDD", "BAP"]

        symbols = load_em_universe(db=db, path=Path("/missing/em-us-listed.json"))

        self.assertEqual(symbols, ["NU", "PDD", "BAP"])
        db.get_em_universe_symbols.assert_called_once()

    def test_falls_back_to_json_when_supabase_empty(self) -> None:
        db = MagicMock()
        db.get_em_universe_symbols.return_value = []

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "em.json"
            path.write_text(
                json.dumps([{"symbol": "VALE"}, {"symbol": "BABA"}]),
                encoding="utf-8",
            )
            symbols = load_em_universe(db=db, path=path)

        self.assertEqual(symbols, ["VALE", "BABA"])

    def test_json_strips_etfs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "em.json"
            path.write_text(
                json.dumps(
                    [
                        {"symbol": "EEM", "name": "iShares MSCI Emerging Markets ETF"},
                        {"symbol": "PDD", "name": "PDD Holdings ADR", "instrument_type": "adr"},
                        {"symbol": "KWEB", "name": "KraneShares CSI China Internet ETF"},
                    ]
                ),
                encoding="utf-8",
            )
            symbols = load_em_universe(path=path)

        self.assertEqual(symbols, ["PDD"])

    def test_infer_instrument_type(self) -> None:
        self.assertEqual(infer_instrument_type("EEM", "iShares ETF"), "etf")
        self.assertEqual(infer_instrument_type("PDD", "PDD Holdings ADR"), "adr")
        self.assertEqual(infer_instrument_type("NU", "NU HOLDINGS CLASS A"), "stock")

    def test_json_caps_at_max_universe_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "em.json"
            entries = [{"symbol": f"S{i}"} for i in range(MAX_UNIVERSE_SIZE + 5)]
            path.write_text(json.dumps(entries), encoding="utf-8")
            symbols = load_em_universe(path=path)

        self.assertEqual(len(symbols), MAX_UNIVERSE_SIZE)


if __name__ == "__main__":
    unittest.main()
