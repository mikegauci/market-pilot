from __future__ import annotations

import unittest

from database.supabase import SupabaseRepository


class RepositoryLockingTest(unittest.TestCase):
    """Methods called from the main loop while the news thread shares the httpx client must hold the DB lock."""

    def test_methods_are_db_synchronized(self) -> None:
        for name in ("get_bot_control", "save_watchlist_rotation", "poll_shutdown_requested"):
            with self.subTest(name=name):
                self.assertTrue(
                    hasattr(getattr(SupabaseRepository, name), "__wrapped__"),
                    f"{name} is missing @_db_synchronized",
                )


if __name__ == "__main__":
    unittest.main()
