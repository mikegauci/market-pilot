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

type ScopeEntry = { promise: Promise<TradeAccountScope>; expiresAt: number; generation: number };

// Memoized per Supabase client. On the server that is one client per request (see
// createClient), so a render's trade and portfolio reads share one bot_status lookup.
const scopeByClient = new WeakMap<SupabaseClient, ScopeEntry>();
let generation = 0;

/** Scope for trade/portfolio reads, shared by every caller using the same client. */
export function resolveTradeAccountScope(supabase: SupabaseClient): Promise<TradeAccountScope> {
  const now = Date.now();
  const hit = scopeByClient.get(supabase);
  if (hit && hit.generation === generation && hit.expiresAt > now) return hit.promise;

  const promise = computeTradeAccountScope(supabase);
  scopeByClient.set(supabase, { promise, expiresAt: now + LIVE_DATA_POLL_MS, generation });
  promise.catch(() => {
    if (scopeByClient.get(supabase)?.promise === promise) scopeByClient.delete(supabase);
  });
  return promise;
}

/**
 * Resolves the account (one bot_status read) and the legacy-trade check. The module-level
 * `cachedScope` is a second, cross-request layer that only saves the legacy count query; the
 * per-client memo above exists to avoid the bot_status read within one render.
 */
async function computeTradeAccountScope(supabase: SupabaseClient): Promise<TradeAccountScope> {
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
  generation += 1;
}
