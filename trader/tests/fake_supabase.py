"""Minimal PostgREST query recorder for repository tests (no network)."""
from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any, Dict, List, Optional


class FakeQuery:
    def __init__(self, client: "FakeSupabaseClient", table: str) -> None:
        self.client = client
        self.call: Dict[str, Any] = {"table": table, "ops": []}

    def __getattr__(self, name: str):
        def op(*args: Any, **kwargs: Any) -> "FakeQuery":
            self.call["ops"].append((name, args, kwargs))
            return self

        return op

    def execute(self) -> SimpleNamespace:
        self.client.calls.append(self.call)
        return SimpleNamespace(data=self.client.next_data(self.call["table"]))


class FakeSupabaseClient:
    def __init__(self, data: Optional[Dict[str, Any]] = None) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.data = data or {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)

    def next_data(self, table: str) -> Any:
        return self.data.get(table, [])


def fake_repository(client: FakeSupabaseClient):
    """A SupabaseRepository wired to `client`, skipping the real constructor."""
    from database.supabase import SupabaseRepository

    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = client
    repo._lock = threading.RLock()
    repo._last_reclaim_mono = {}
    repo._profile_capital_cache = {}
    repo._cached_risk_sync_equity = None
    repo._cached_risk_sync_account_id = None
    repo._known_position_symbols = None
    repo._legacy_untagged_cache = {}
    return repo
