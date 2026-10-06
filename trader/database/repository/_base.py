from __future__ import annotations

import threading
from typing import Dict, Optional

from database.supabase_support import (
    Client,
    ClientOptions,
    _build_supabase_http_client,
    create_client,
)
from database.trade_account_scope import include_legacy_untagged_trades


class SupabaseRepositoryBase:
    def __init__(self, url: str, service_role_key: str) -> None:
        if not url or not service_role_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self._http = _build_supabase_http_client()
        self.client: Client = create_client(
            url,
            service_role_key,
            options=ClientOptions(httpx_client=self._http),
        )
        self._lock = threading.RLock()
        self._cached_risk_sync_equity: Optional[float] = None
        self._cached_risk_sync_account_id: Optional[str] = None
        self._profile_capital_cache: Dict[str, float] = {}
        self._known_position_symbols: Optional[set[str]] = None
        self._legacy_untagged_cache: Dict[str, bool] = {}

    def _include_legacy_untagged(self, ibkr_account_id: str) -> bool:
        cached = self._legacy_untagged_cache.get(ibkr_account_id)
        if cached is not None:
            return cached
        include_legacy = include_legacy_untagged_trades(
            self.client,
            ibkr_account_id,
        )
        self._legacy_untagged_cache[ibkr_account_id] = include_legacy
        return include_legacy

    def invalidate_legacy_untagged_cache(self, ibkr_account_id: Optional[str] = None) -> None:
        if ibkr_account_id is None:
            self._legacy_untagged_cache.clear()
        else:
            self._legacy_untagged_cache.pop(ibkr_account_id, None)
