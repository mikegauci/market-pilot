"use client";

import { useCallback, useRef } from "react";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { createClient } from "@/lib/supabase/client";
import { clearTradeAccountScopeCache } from "@/lib/trade-account-scope";
import type { BotStatus } from "@/lib/types/database";

async function fetchBotStatus(): Promise<BotStatus | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("bot_status")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("bot_status fetch failed:", error.message);
    }
    return null;
  }
  return data as BotStatus;
}

/** Keep bot_status fresh via client polling + Realtime (SSR props alone go stale). */
export function useBotStatus(initialStatus: BotStatus): BotStatus {
  const accountIdRef = useRef(initialStatus.ibkr_account_id);

  // Clear the trade-scope cache before the new status reaches subscribers, so their
  // account-keyed refetches resolve against the new account.
  const fetchStatus = useCallback(async () => {
    const next = await fetchBotStatus();
    if (next && next.ibkr_account_id !== accountIdRef.current) {
      accountIdRef.current = next.ibkr_account_id;
      clearTradeAccountScopeCache();
    }
    return next;
  }, []);

  // keepPreviousOnNull: a failed read never replaces the last good status.
  return useLiveQuery<BotStatus | null>(initialStatus, fetchStatus, ["bot_status"], undefined, {
    keepPreviousOnNull: true,
  }) as BotStatus;
}
