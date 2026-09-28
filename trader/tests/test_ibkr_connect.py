from __future__ import annotations

import unittest

from broker.ibkr import IBKRClient


class TestIBKRClientIdConflict(unittest.TestCase):
    def setUp(self) -> None:
        self.client = IBKRClient("127.0.0.1", 4002, client_id=1)

    def test_detects_error_326_message(self) -> None:
        exc = Exception("Error 326: Unable to connect as the client id is already in use")
        self.assertTrue(self.client._is_client_id_conflict(exc))

    def test_detects_immediate_disconnect_message(self) -> None:
        exc = RuntimeError("IBKR disconnected immediately (clientId=1 may be in use)")
        self.assertTrue(self.client._is_client_id_conflict(exc))

    def test_ignores_unrelated_errors(self) -> None:
        exc = TimeoutError("connection timed out")
        self.assertFalse(self.client._is_client_id_conflict(exc))


if __name__ == "__main__":
    unittest.main()
