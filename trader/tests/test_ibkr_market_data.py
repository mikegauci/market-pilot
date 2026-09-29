from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from broker.ibkr import (
    IBKRClient,
    MARKET_DATA_COMPETING_SESSION_CODE,
    MARKET_DATA_TYPE_DELAYED,
)
from models.types import Quote


class TestIBKRMarketDataErrors(unittest.TestCase):
    def setUp(self) -> None:
        self.client = IBKRClient("127.0.0.1", 4002, client_id=1)

    def test_competing_session_error_sets_blocked_flag(self) -> None:
        self.assertFalse(self.client.market_data_is_blocked())
        self.client._on_ib_error(325, MARKET_DATA_COMPETING_SESSION_CODE, "competing live", None)
        self.assertTrue(self.client.market_data_is_blocked())

    def test_other_errors_do_not_set_blocked_flag(self) -> None:
        self.client._on_ib_error(1, 2104, "market data farm connection is OK", None)
        self.assertFalse(self.client.market_data_is_blocked())


class TestIBKRMarketDataRecovery(unittest.TestCase):
    def setUp(self) -> None:
        self.client = IBKRClient("127.0.0.1", 4002, client_id=1, market_data_type=1)
        self.client.ib = MagicMock()
        self.client.ib.isConnected.return_value = True

    def test_count_priced_symbols(self) -> None:
        self.client._tickers = {
            "AAPL": MagicMock(last=150.0, close=None, delayedLast=None, marketPrice=lambda: None, bid=-1, ask=-1),
            "MSFT": MagicMock(last=None, close=None, delayedLast=None, marketPrice=lambda: None, bid=-1, ask=-1),
        }
        priced, total = self.client._count_priced_symbols(["AAPL", "MSFT"])
        self.assertEqual((priced, total), (1, 2))

    def test_ensure_market_data_ready_returns_stream_when_priced(self) -> None:
        self.client._count_priced_symbols = MagicMock(return_value=(2, 2))
        mode = self.client.ensure_market_data_ready(["AAPL", "MSFT"], wait_sec=0)
        self.assertEqual(mode, "stream")
        self.assertFalse(self.client._use_snapshot_quotes)

    def test_ensure_market_data_ready_falls_back_to_snapshot(self) -> None:
        self.client._count_priced_symbols = MagicMock(return_value=(0, 2))
        self.client._market_data_blocked = True
        self.client._try_recover_streaming_market_data = MagicMock(return_value=False)
        self.client._get_snapshot_quotes = MagicMock(
            return_value=[
                Quote(symbol="AAPL", price=150.0, bid=None, ask=None, spread=None),
                Quote(symbol="MSFT", price=300.0, bid=None, ask=None, spread=None),
            ]
        )

        mode = self.client.ensure_market_data_ready(["AAPL", "MSFT"], wait_sec=0)

        self.assertEqual(mode, "snapshot")
        self.assertTrue(self.client._use_snapshot_quotes)
        self.client._get_snapshot_quotes.assert_called_once()

    def test_try_recover_streaming_switches_to_delayed(self) -> None:
        self.client._count_priced_symbols = MagicMock(return_value=(1, 1))
        with patch.object(self.client, "subscribe_watchlist"):
            recovered = self.client._try_recover_streaming_market_data(["AAPL"], wait_sec=0)
        self.assertTrue(recovered)
        self.assertEqual(self.client.market_data_type, MARKET_DATA_TYPE_DELAYED)
        self.client.ib.reqMarketDataType.assert_called_with(MARKET_DATA_TYPE_DELAYED)

    def test_get_quotes_uses_snapshot_path_when_enabled(self) -> None:
        self.client._use_snapshot_quotes = True
        expected = [
            Quote(symbol="AAPL", price=150.0, bid=None, ask=None, spread=None),
        ]
        with patch.object(self.client, "_get_snapshot_quotes", return_value=expected) as snapshot:
            quotes = self.client.get_quotes(["AAPL"], wait_sec=0)
        snapshot.assert_called_once_with(["AAPL"], 0)
        self.assertEqual(quotes, expected)


if __name__ == "__main__":
    unittest.main()
