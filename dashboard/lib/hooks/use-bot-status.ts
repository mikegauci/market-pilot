"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initialDataChanged } from "@/lib/hooks/use-live-query";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";
import type { BotStatus } from "@/lib/types/database";

const POLL_INTERVAL_MS = 10_000;

export async function fetchBotStatus(): Promise<BotStatus | null> {
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
  const [status, setStatus] = useState(initialStatus);
  const syncedInitialRef = useRef(initialStatus);

  const refresh = useCallback(async () => {
    const next = await fetchBotStatus();
    if (next) setStatus(next);
  }, []);

  useEffect(() => {
    if (!initialDataChanged(syncedInitialRef.current, initialStatus)) {
      return;
    }
    syncedInitialRef.current = initialStatus;
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [refresh]);

  useRealtimeRefresh(["bot_status"], () => {
    void refresh();
  });

  return status;
}
