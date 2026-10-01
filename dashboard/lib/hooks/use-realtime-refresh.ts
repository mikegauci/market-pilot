"use client";

import { useEffect } from "react";
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
};

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

  const entry: ChannelEntry = { channel, callbacks, refCount: 0 };
  sharedChannels.set(tableKey, entry);
  return entry;
}

export function useRealtimeRefresh(tables: string[], onRefresh: () => void) {
  const tableKey = tables.slice().sort().join(",");

  useEffect(() => {
    if (tables.length === 0) {
      return;
    }
    const entry = getOrCreateChannel(tableKey);
    entry.callbacks.add(onRefresh);
    entry.refCount += 1;

    return () => {
      entry.callbacks.delete(onRefresh);
      entry.refCount -= 1;

      if (entry.refCount <= 0) {
        const supabase = createClient();
        void supabase.removeChannel(entry.channel);
        sharedChannels.delete(tableKey);
      }
    };
  }, [tableKey, onRefresh, tables.length]);
}
