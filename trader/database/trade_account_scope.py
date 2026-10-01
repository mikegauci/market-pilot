from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from supabase import Client


def include_legacy_untagged_trades(client: "Client", account_id: str) -> bool:
    """Untagged trades count for this account only when no other account is tagged."""
    result = (
        client.table("trades")
        .select("id")
        .not_.is_("ibkr_account_id", "null")
        .neq("ibkr_account_id", account_id)
        .limit(1)
        .execute()
    )
    rows = result.data if result is not None else None
    return not rows


def apply_trade_account_filter(
    query: Any,
    account_id: Optional[str],
    *,
    include_legacy: bool,
) -> Any:
    if not account_id:
        return query
    if include_legacy:
        return query.or_(f"ibkr_account_id.eq.{account_id},ibkr_account_id.is.null")
    return query.eq("ibkr_account_id", account_id)
