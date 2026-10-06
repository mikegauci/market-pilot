from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from database.repository import SupabaseRepository


class SupabaseRepositoryCompositionTests(unittest.TestCase):
    @patch("database.repository._base.create_client")
    def test_composed_repository_exposes_domain_methods(
        self, create_client: MagicMock
    ) -> None:
        create_client.return_value = MagicMock()
        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")

        for name in (
            "get_risk_settings",
            "get_open_trades",
            "insert_portfolio_snapshot",
            "update_bot_status",
            "write_heartbeat",
        ):
            self.assertTrue(
                callable(getattr(repo, name, None)),
                f"missing method {name}",
            )


if __name__ == "__main__":
    unittest.main()
