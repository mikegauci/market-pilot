"use client";

import { useEffect, useState } from "react";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { useBotStatus } from "@/lib/hooks/use-bot-status";
import { getStableDisplayNow, isTraderOnline } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";

/** Live trader online state (polls bot_status heartbeat). */
export function useTraderOnline(initialStatus: BotStatus): boolean {
  const status = useBotStatus(initialStatus);
  const stableNow = getStableDisplayNow(status.last_heartbeat);
  const isClient = useIsClient();
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (!isClient) return;
    const id = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [isClient]);

  void clock;
  return isClient
    ? isTraderOnline(status.last_heartbeat)
    : isTraderOnline(status.last_heartbeat, stableNow);
}
