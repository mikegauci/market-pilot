import type { SupabaseClient } from "@supabase/supabase-js";

/** True when untagged trades can be attributed to this account (no other account tags). */
export async function includeLegacyUntaggedTrades(
  supabase: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .not("ibkr_account_id", "is", null)
    .neq("ibkr_account_id", accountId);

  if (error) {
    return false;
  }
  return (count ?? 0) === 0;
}

/** Apply active-account filter to a trades query (mutates builder via return). */
export async function filterTradesByActiveIbkrAccount<T extends {
  or: (filter: string) => T;
  eq: (column: string, value: string) => T;
}>(
  supabase: SupabaseClient,
  accountId: string,
  query: T,
  includeLegacy?: boolean,
): Promise<T> {
  const legacy =
    includeLegacy ?? (await includeLegacyUntaggedTrades(supabase, accountId));
  if (legacy) {
    return query.or(`ibkr_account_id.eq.${accountId},ibkr_account_id.is.null`) as T;
  }
  return query.eq("ibkr_account_id", accountId) as T;
}
