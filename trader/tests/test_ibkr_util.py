from __future__ import annotations

import asyncio
import unittest

from broker.ibkr._util import is_ibkr_request_timeout


class TestIsIbkrRequestTimeout(unittest.TestCase):
    def test_asyncio_timeout(self) -> None:
        self.assertTrue(is_ibkr_request_timeout(asyncio.TimeoutError()))

    def test_builtin_timeout(self) -> None:
        self.assertTrue(is_ibkr_request_timeout(TimeoutError("timed out")))

    def test_message_heuristic(self) -> None:
        self.assertTrue(is_ibkr_request_timeout(RuntimeError("Request timed out")))

    def test_other_errors_false(self) -> None:
        self.assertFalse(is_ibkr_request_timeout(RuntimeError("connection refused")))


if __name__ == "__main__":
    unittest.main()
