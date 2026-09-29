"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";

/** Poll interval aligned with trader heartbeat (2s) plus a small buffer. */
export const LIVE_DATA_POLL_MS = 3_000;

export function initialDataChanged<T>(prev: T, next: T): boolean {
  if (Object.is(prev, next)) return false;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return true;
    if (prev.length === 0) return false;
    return prev.some((item, index) => initialDataChanged(item, next[index]));
  }
  if (
    prev !== null &&
    next !== null &&
    typeof prev === "object" &&
    typeof next === "object"
  ) {
    const prevRecord = prev as Record<string, unknown>;
    const nextRecord = next as Record<string, unknown>;
    const prevKeys = Object.keys(prevRecord);
    const nextKeys = Object.keys(nextRecord);
    if (prevKeys.length !== nextKeys.length) return true;
    return prevKeys.some((key) => prevRecord[key] !== nextRecord[key]);
  }
  return true;
}

export function useLiveQuery<T>(
  initial: T,
  fetchFn: () => Promise<T>,
  tables: string[],
  pollIntervalMs = LIVE_DATA_POLL_MS,
  options?: { keepPreviousOnNull?: boolean },
): T {
  const [data, setData] = useState(initial);
  const syncedInitialRef = useRef(initial);
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
    if (!initialDataChanged(syncedInitialRef.current, initial)) {
      return;
    }
    syncedInitialRef.current = initial;
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
