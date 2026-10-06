from __future__ import annotations

import unittest

from broker.ibkr import IBKRClient


class IBKRClientCompositionTests(unittest.TestCase):
    def test_client_exposes_connection_market_and_order_surface(self) -> None:
        client = IBKRClient("127.0.0.1", 4002, client_id=7)

        self.assertFalse(client.is_connected())
        for name in (
            "connect",
            "disconnect",
            "get_account_summary",
            "get_quotes",
            "place_bracket_buy",
        ):
            self.assertTrue(
                callable(getattr(client, name, None)),
                f"missing method {name}",
            )


if __name__ == "__main__":
    unittest.main()
