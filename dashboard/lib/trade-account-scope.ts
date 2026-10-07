import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDashboardIbkrAccount,
  type IbkrAccountSource,
} from "@/lib/active-ibkr-account";
import { includeLegacyUntaggedTrades } from "@/lib/ibkr-trade-scope";
import { LIVE_DATA_POLL_MS } from "@/lib/live-data-config";

export type TradeAccountScope = {
  accountId: string | null;
  includeLegacy: boolean;
  source: IbkrAccountSource | null;
};

let cachedScope: { scope: TradeAccountScope; expiresAt: number } | null = null;

/** Cached legacy trade tag check; account id uses live bot status or dashboard fallback. */
export async function resolveTradeAccountScope(
  supabase: SupabaseClient,
): Promise<TradeAccountScope> {
  const { accountId, source } = await resolveDashboardIbkrAccount(supabase);
  const now = Date.now();

  if (
    cachedScope &&
    cachedScope.expiresAt > now &&
    cachedScope.scope.accountId === accountId &&
    cachedScope.scope.source === source
  ) {
    return cachedScope.scope;
  }

  if (!accountId) {
    const scope = { accountId: null, includeLegacy: false, source: null };
    cachedScope = { scope, expiresAt: now + LIVE_DATA_POLL_MS };
    return scope;
  }

  const includeLegacy = await includeLegacyUntaggedTrades(supabase, accountId);
  const scope = { accountId, includeLegacy, source };
  cachedScope = { scope, expiresAt: now + LIVE_DATA_POLL_MS };
  return scope;
}

export function clearTradeAccountScopeCache(): void {
  cachedScope = null;
}
