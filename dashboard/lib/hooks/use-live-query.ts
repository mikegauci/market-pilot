"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";
import { LIVE_DATA_POLL_MS, liveRealtimeTables } from "@/lib/live-data-config";

export { LIVE_DATA_POLL_MS };

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

/** Skip replacing good poll data with an empty list (transient auth/network failures). */
export function shouldApplyLiveQueryUpdate<T>(
  current: T,
  next: T,
  options: { keepPreviousOnNull?: boolean; keepPreviousOnEmpty?: boolean },
): boolean {
  if (options.keepPreviousOnNull && next === null) {
    return false;
  }
  if (
    options.keepPreviousOnEmpty &&
    Array.isArray(current) &&
    Array.isArray(next) &&
    current.length > 0 &&
    next.length === 0
  ) {
    return false;
  }
  return true;
}

export function useLiveQuery<T>(
  initial: T,
  fetchFn: () => Promise<T>,
  tables: string[],
  pollIntervalMs = LIVE_DATA_POLL_MS,
  options?: {
    keepPreviousOnNull?: boolean;
    keepPreviousOnEmpty?: boolean;
    resetKey?: string | number | null;
    /** Initial value was just rendered on the server: wait for the first poll instead of refetching on mount. */
    skipInitialFetch?: boolean;
  },
): T {
  const [data, setData] = useState(initial);
  const syncedInitialRef = useRef(initial);
  const keepPreviousOnNull = options?.keepPreviousOnNull ?? false;
  const keepPreviousOnEmpty = options?.keepPreviousOnEmpty ?? false;
  const resetKey = options?.resetKey ?? null;
  const resetKeyRef = useRef(resetKey);
  const skipInitialFetch = options?.skipInitialFetch ?? false;

  const refresh = useCallback(async () => {
    try {
      const next = await fetchFn();
      if (resetKeyRef.current !== resetKey) {
        return;
      }
      setData((current) => {
        if (
          !shouldApplyLiveQueryUpdate(current, next, {
            keepPreviousOnNull,
            keepPreviousOnEmpty,
          })
        ) {
          return current;
        }
        if (!initialDataChanged(current, next)) {
          return current;
        }
        return next;
      });
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Live data refresh failed:", err);
      }
    }
  }, [fetchFn, keepPreviousOnNull, keepPreviousOnEmpty, resetKey]);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) {
      return;
    }
    resetKeyRef.current = resetKey;
    syncedInitialRef.current = initial;
    setData(initial);
    void refresh();
  }, [resetKey, initial, refresh]);

  useEffect(() => {
    if (!initialDataChanged(syncedInitialRef.current, initial)) {
      return;
    }
    syncedInitialRef.current = initial;
    setData((current) => {
      if (
        !shouldApplyLiveQueryUpdate(current, initial, {
          keepPreviousOnNull,
          keepPreviousOnEmpty,
        })
      ) {
        return current;
      }
      return initial;
    });
  }, [initial, keepPreviousOnNull, keepPreviousOnEmpty]);

  useEffect(() => {
    // Only trust server data that has content: null/empty may be a swallowed read error, so refetch.
    const serverSeeded =
      skipInitialFetch &&
      initial !== null &&
      initial !== undefined &&
      !(Array.isArray(initial) && initial.length === 0);
    const kickoff = serverSeeded ? null : window.setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), pollIntervalMs);
    return () => {
      if (kickoff !== null) window.clearTimeout(kickoff);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial is read only at mount
  }, [refresh, pollIntervalMs, skipInitialFetch]);

  const realtimeTables = liveRealtimeTables(tables);
  useRealtimeRefresh(realtimeTables, refresh);

  return data;
}
