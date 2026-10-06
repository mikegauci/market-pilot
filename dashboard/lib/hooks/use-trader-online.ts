"use client";

import { useContext, useEffect, useState } from "react";
import { BotStatusContext } from "@/components/bot-status-provider";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { getStableDisplayNow, isTraderOnline } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";

const offlineFallback: BotStatus = {
  id: 1,
  enabled: false,
  trading_mode: "paper",
  execution_mode: "ibkr",
  ibkr_connected: false,
  jev_connected: false,
  ibkr_account_id: null,
  last_heartbeat: null,
  last_error: null,
  updated_at: "",
};

function useTraderOnlineFromStatus(status: BotStatus): boolean {
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

/** Live trader online state (prefers shared bot_status from DashboardShell). */
export function useTraderOnline(fallbackStatus?: BotStatus | null): boolean {
  const fromProvider = useContext(BotStatusContext);
  const status = fromProvider ?? fallbackStatus ?? offlineFallback;
  return useTraderOnlineFromStatus(status);
}
