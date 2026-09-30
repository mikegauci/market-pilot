from __future__ import annotations

import unittest

import httpx

from database.supabase import _is_transient_db_error


class TestTransientDbErrors(unittest.TestCase):
    def test_httpx_timeouts_are_transient(self) -> None:
        self.assertTrue(_is_transient_db_error(httpx.ReadTimeout("read timed out")))
        self.assertTrue(_is_transient_db_error(httpx.ConnectTimeout("connect timed out")))

    def test_statement_timeout_messages_are_transient(self) -> None:
        self.assertTrue(
            _is_transient_db_error(
                RuntimeError("canceling statement due to statement timeout")
            )
        )
        self.assertTrue(_is_transient_db_error(RuntimeError("Postgres 57014")))

    def test_unrelated_errors_are_not_transient(self) -> None:
        self.assertFalse(_is_transient_db_error(ValueError("bad payload")))


if __name__ == "__main__":
    unittest.main()
