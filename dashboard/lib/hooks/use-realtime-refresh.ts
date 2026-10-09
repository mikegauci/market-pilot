"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { REALTIME_DEBOUNCE_MS } from "@/lib/live-data-config";
import { createClient } from "@/lib/supabase/client";

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDebouncedRefresh(tableKey: string, callbacks: Set<() => void>) {
  const pending = debounceTimers.get(tableKey);
  if (pending) {
    clearTimeout(pending);
  }
  debounceTimers.set(
    tableKey,
    setTimeout(() => {
      debounceTimers.delete(tableKey);
      callbacks.forEach((callback) => callback());
    }, REALTIME_DEBOUNCE_MS),
  );
}

type ChannelEntry = {
  channel: RealtimeChannel;
  callbacks: Set<() => void>;
  refCount: number;
  removeTimer: ReturnType<typeof setTimeout> | null;
};

/** Keep an unused channel briefly so navigating between pages reuses it instead of rejoining. */
const CHANNEL_LINGER_MS = 5_000;

const sharedChannels = new Map<string, ChannelEntry>();

function getOrCreateChannel(tableKey: string): ChannelEntry {
  const existing = sharedChannels.get(tableKey);
  if (existing) {
    return existing;
  }

  const supabase = createClient();
  const callbacks = new Set<() => void>();
  const channel = supabase.channel(`dashboard-${tableKey}`);
  const tables = tableKey.split(",");

  tables.forEach((table) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => {
        scheduleDebouncedRefresh(tableKey, callbacks);
      },
    );
  });

  channel.subscribe();

  const entry: ChannelEntry = { channel, callbacks, refCount: 0, removeTimer: null };
  sharedChannels.set(tableKey, entry);
  return entry;
}

export function useRealtimeRefresh(tables: string[], onRefresh: () => void) {
  const tableKey = tables.slice().sort().join(",");
  const hasTables = tables.length > 0;
  // Subscribe once per table set; always call the latest callback.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  useEffect(() => {
    if (!hasTables) {
      return;
    }
    const entry = getOrCreateChannel(tableKey);
    if (entry.removeTimer) {
      clearTimeout(entry.removeTimer);
      entry.removeTimer = null;
    }
    const callback = () => onRefreshRef.current();
    entry.callbacks.add(callback);
    entry.refCount += 1;

    return () => {
      entry.callbacks.delete(callback);
      entry.refCount -= 1;

      if (entry.refCount <= 0 && !entry.removeTimer) {
        entry.removeTimer = setTimeout(() => {
          if (entry.refCount > 0 || sharedChannels.get(tableKey) !== entry) return;
          sharedChannels.delete(tableKey);
          void createClient().removeChannel(entry.channel);
        }, CHANNEL_LINGER_MS);
      }
    };
  }, [tableKey, hasTables]);
}
