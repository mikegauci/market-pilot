"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function useRealtimeRefresh(tables: string[], onRefresh: () => void) {
  const tableKey = tables.slice().sort().join(",");

  useEffect(() => {
    const supabase = createClient();
    const channelName = `dashboard-${tableKey}`;
    const channel = supabase.channel(channelName);

    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => onRefresh(),
      );
    });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tableKey, onRefresh]);
}
