from __future__ import annotations

import threading
import unittest
from unittest.mock import MagicMock, patch

from database.repository import _commands
from database.repository._commands import SupabaseCommandsMixin


class _Repo(SupabaseCommandsMixin):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._last_reclaim_mono = {}
        self.client = MagicMock()
        self.client.table.return_value.update.return_value.eq.return_value.lt.return_value.execute.return_value.data = []


class ReclaimThrottleTests(unittest.TestCase):
    def test_reclaim_runs_once_per_interval_per_table(self) -> None:
        repo = _Repo()
        clock = {"now": 100.0}
        with patch.object(_commands.time, "monotonic", side_effect=lambda: clock["now"]):
            repo.reclaim_stale_trade_commands()
            clock["now"] = 110.0
            repo.reclaim_stale_trade_commands()  # 10s later: skipped
            repo.reclaim_stale_position_commands()  # other table: runs
            clock["now"] = 131.0
            repo.reclaim_stale_trade_commands()  # 31s after the first: runs
        tables = [call.args[0] for call in repo.client.table.call_args_list]
        self.assertEqual(tables, ["trade_commands", "position_commands", "trade_commands"])

    def test_failed_reclaim_is_retried_on_the_next_poll(self) -> None:
        repo = _Repo()
        execute = repo.client.table.return_value.update.return_value.eq.return_value.lt.return_value.execute
        execute.side_effect = [RuntimeError("db down"), MagicMock(data=[])]
        with patch.object(_commands.time, "monotonic", return_value=100.0):
            with self.assertRaises(RuntimeError):
                repo.reclaim_stale_trade_commands()
            repo.reclaim_stale_trade_commands()  # same instant, but the first never succeeded
        self.assertEqual(execute.call_count, 2)


if __name__ == "__main__":
    unittest.main()
