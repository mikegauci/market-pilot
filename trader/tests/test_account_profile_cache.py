from __future__ import annotations

import unittest
from unittest.mock import patch

from tests.fake_supabase import FakeSupabaseClient, fake_repository

PROFILE = {"account_id": "DU1", "baseline_equity": 1000.0}


class AccountProfileCacheTests(unittest.TestCase):
    def test_existing_profile_is_read_once_within_ttl(self) -> None:
        client = FakeSupabaseClient({"ibkr_account_profiles": [PROFILE]})
        repo = fake_repository(client)
        self.assertEqual(repo.ensure_account_profile("DU1", 1200.0), PROFILE)
        self.assertEqual(repo.ensure_account_profile("DU1", 1250.0), PROFILE)
        self.assertEqual(len(client.calls), 1)

    def test_profile_is_reread_after_ttl(self) -> None:
        client = FakeSupabaseClient({"ibkr_account_profiles": [PROFILE]})
        repo = fake_repository(client)
        with patch("database.repository._accounts.time.monotonic", return_value=0.0):
            repo.ensure_account_profile("DU1", 1200.0)
        with patch("database.repository._accounts.time.monotonic", return_value=601.0):
            repo.ensure_account_profile("DU1", 1200.0)
        self.assertEqual(len(client.calls), 2)


if __name__ == "__main__":
    unittest.main()
