from __future__ import annotations

import unittest

from tests.fake_supabase import FakeSupabaseClient, fake_repository

QUEUES = {
    "trade": ("trade_commands", "id, trade_id, command, reason, requested_at"),
    "position": ("position_commands", "id, symbol, quantity, command, reason, requested_at"),
    "entry": ("entry_commands", "id, symbol, quantity, command, reason, requested_at"),
}


class CommandQueueTests(unittest.TestCase):
    def test_pending_select_per_queue(self) -> None:
        for name, (table, columns) in QUEUES.items():
            with self.subTest(queue=name):
                client = FakeSupabaseClient({table: [{"id": "c1"}]})
                repo = fake_repository(client)
                rows = getattr(repo, f"get_pending_{name}_commands")()
                self.assertEqual(rows, [{"id": "c1"}])
                call = client.calls[-1]
                self.assertEqual(call["table"], table)
                self.assertEqual(
                    call["ops"],
                    [
                        ("select", (columns,), {}),
                        ("eq", ("status", "pending"), {}),
                        ("order", ("requested_at",), {}),
                        ("limit", (10,), {}),
                    ],
                )

    def test_claim_only_from_pending(self) -> None:
        for name, (table, _) in QUEUES.items():
            with self.subTest(queue=name):
                client = FakeSupabaseClient({table: [{"id": "c1"}]})
                repo = fake_repository(client)
                self.assertTrue(getattr(repo, f"claim_{name}_command")("c1"))
                ops = client.calls[-1]["ops"]
                self.assertEqual(ops[0][0], "update")
                self.assertEqual(ops[0][1][0]["status"], "processing")
                self.assertEqual(ops[1:], [("eq", ("id", "c1"), {}), ("eq", ("status", "pending"), {})])

                empty = FakeSupabaseClient({table: []})
                self.assertFalse(getattr(fake_repository(empty), f"claim_{name}_command")("c1"))

    def test_complete_and_fail_payloads(self) -> None:
        for name, (table, _) in QUEUES.items():
            with self.subTest(queue=name):
                client = FakeSupabaseClient()
                repo = fake_repository(client)
                getattr(repo, f"complete_{name}_command")("c1")
                getattr(repo, f"fail_{name}_command")("c2", "x" * 600)
                done, failed = (call["ops"][0][1][0] for call in client.calls)
                self.assertEqual(done["status"], "completed")
                self.assertIsNone(done["error"])
                self.assertEqual(failed["status"], "failed")
                self.assertEqual(len(failed["error"]), 500)
                self.assertEqual([c["table"] for c in client.calls], [table, table])

    def test_reclaim_is_throttled_per_table(self) -> None:
        client = FakeSupabaseClient({"trade_commands": [{"id": "a"}, {"id": "b"}]})
        repo = fake_repository(client)
        self.assertEqual(repo.reclaim_stale_trade_commands(), 2)
        self.assertEqual(repo.reclaim_stale_trade_commands(), 0)
        self.assertEqual(repo.reclaim_stale_entry_commands(), 0)
        self.assertEqual([c["table"] for c in client.calls], ["trade_commands", "entry_commands"])
        ops = client.calls[0]["ops"]
        self.assertEqual(ops[1], ("eq", ("status", "processing"), {}))
        self.assertEqual(ops[2][0], "lt")


if __name__ == "__main__":
    unittest.main()
