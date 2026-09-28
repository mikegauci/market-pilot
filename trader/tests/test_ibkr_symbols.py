from __future__ import annotations

import unittest
from types import SimpleNamespace

from broker.ibkr import IBKRClient
from broker.symbols import from_ibkr_contract, to_ibkr_symbol


class TestIBKRSymbolMapping(unittest.TestCase):
    def test_to_ibkr_symbol_replaces_dots_with_spaces(self) -> None:
        self.assertEqual(to_ibkr_symbol("BRK.B"), "BRK B")
        self.assertEqual(to_ibkr_symbol("BF.B"), "BF B")
        self.assertEqual(to_ibkr_symbol("AAPL"), "AAPL")

    def test_from_ibkr_contract_reverses_class_share_format(self) -> None:
        self.assertEqual(from_ibkr_contract("BRK", "BRK B"), "BRK.B")
        self.assertEqual(from_ibkr_contract("AAPL", "AAPL"), "AAPL")

    def test_resolve_app_symbol_uses_cached_con_id(self) -> None:
        client = IBKRClient("127.0.0.1", 4002, client_id=1)
        cached = SimpleNamespace(conId=12345, symbol="BRK", localSymbol="BRK B")
        client._contracts["BRK.B"] = cached  # type: ignore[assignment]

        contract = SimpleNamespace(conId=12345, symbol="BRK", localSymbol="BRK B")
        self.assertEqual(client._resolve_app_symbol(contract), "BRK.B")

    def test_contract_matches_symbol_for_class_shares(self) -> None:
        client = IBKRClient("127.0.0.1", 4002, client_id=1)
        cached = SimpleNamespace(conId=99, symbol="BRK", localSymbol="BRK B")
        client._contracts["BRK.B"] = cached  # type: ignore[assignment]

        contract = SimpleNamespace(conId=99, symbol="BRK", localSymbol="BRK B")
        self.assertTrue(client._contract_matches_symbol(contract, "BRK.B"))
        self.assertFalse(client._contract_matches_symbol(contract, "AAPL"))


if __name__ == "__main__":
    unittest.main()
