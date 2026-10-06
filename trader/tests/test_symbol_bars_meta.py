from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from database.supabase import SupabaseRepository


class SymbolBarsMetaTests(unittest.TestCase):
    @patch("database.repository._base.create_client")
    def test_get_last_fetched_at_returns_none_when_no_rows(self, create_client: MagicMock) -> None:
        response = MagicMock()
        response.data = []
        table = MagicMock()
        table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
            response
        )
        client = MagicMock()
        client.table.return_value = table
        create_client.return_value = client

        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")
        self.assertIsNone(repo.get_last_fetched_at("NU", "1 day"))

    @patch("database.repository._base.create_client")
    def test_get_last_fetched_at_returns_none_when_execute_returns_none(
        self, create_client: MagicMock
    ) -> None:
        table = MagicMock()
        table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
            None
        )
        client = MagicMock()
        client.table.return_value = table
        create_client.return_value = client

        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")
        self.assertIsNone(repo.get_last_fetched_at("NU", "5 mins"))

    @patch("database.repository._base.create_client")
    def test_get_last_fetched_at_parses_timestamp(self, create_client: MagicMock) -> None:
        ts = "2026-09-29T06:54:07.794+00:00"
        response = MagicMock()
        response.data = [{"last_fetched_at": ts}]
        table = MagicMock()
        table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
            response
        )
        client = MagicMock()
        client.table.return_value = table
        create_client.return_value = client

        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")
        parsed = repo.get_last_fetched_at("NU", "1 day")
        assert parsed is not None
        self.assertEqual(parsed, datetime(2026, 9, 29, 6, 54, 7, 794000, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
