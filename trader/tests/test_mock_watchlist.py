from __future__ import annotations

import unittest

from market.mock import MockMarketProvider


class TestMockWatchlist(unittest.TestCase):
    def test_ensure_symbols_returns_only_new_symbols(self) -> None:
        mock = MockMarketProvider(["SPY", "QQQ"])
        added = mock.ensure_symbols(["SPY", "QQQ", "TSLA"])
        self.assertEqual(added, ["TSLA"])
        self.assertIn("TSLA", mock.symbols)

    def test_get_quotes_includes_requested_symbols(self) -> None:
        mock = MockMarketProvider(["SPY"])
        quotes = mock.get_quotes(["SPY", "AAPL"])
        symbols = {quote.symbol for quote in quotes}
        self.assertEqual(symbols, {"SPY", "AAPL"})


if __name__ == "__main__":
    unittest.main()
