"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";

/** Poll interval aligned with trader heartbeat (2s) plus a small buffer. */
export const LIVE_DATA_POLL_MS = 3_000;

export function useLiveQuery<T>(
  initial: T,
  fetchFn: () => Promise<T>,
  tables: string[],
  pollIntervalMs = LIVE_DATA_POLL_MS,
  options?: { keepPreviousOnNull?: boolean },
): T {
  const [data, setData] = useState(initial);
  const keepPreviousOnNull = options?.keepPreviousOnNull ?? false;

  const refresh = useCallback(async () => {
    try {
      const next = await fetchFn();
      if (keepPreviousOnNull && next === null) {
        return;
      }
      setData(next);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Live data refresh failed:", err);
      }
    }
  }, [fetchFn, keepPreviousOnNull]);

  useEffect(() => {
    setData(initial);
  }, [initial]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  useRealtimeRefresh(tables, () => {
    void refresh();
  });

  return data;
}
