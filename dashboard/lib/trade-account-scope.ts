import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchActiveIbkrAccountId } from "@/lib/active-ibkr-account";
import { includeLegacyUntaggedTrades } from "@/lib/ibkr-trade-scope";
import { LIVE_DATA_POLL_MS } from "@/lib/live-data-config";

type TradeAccountScope = {
  accountId: string | null;
  includeLegacy: boolean;
};

let cachedScope: { scope: TradeAccountScope; expiresAt: number } | null = null;

/** Cached legacy trade tag check; account id is always read fresh from bot_status. */
export async function resolveTradeAccountScope(
  supabase: SupabaseClient,
): Promise<TradeAccountScope> {
  const accountId = await fetchActiveIbkrAccountId(supabase);
  const now = Date.now();

  if (
    cachedScope &&
    cachedScope.expiresAt > now &&
    cachedScope.scope.accountId === accountId
  ) {
    return cachedScope.scope;
  }

  if (!accountId) {
    const scope = { accountId: null, includeLegacy: false };
    cachedScope = { scope, expiresAt: now + LIVE_DATA_POLL_MS };
    return scope;
  }

  const includeLegacy = await includeLegacyUntaggedTrades(supabase, accountId);
  const scope = { accountId, includeLegacy };
  cachedScope = { scope, expiresAt: now + LIVE_DATA_POLL_MS };
  return scope;
}

export function clearTradeAccountScopeCache(): void {
  cachedScope = null;
}
