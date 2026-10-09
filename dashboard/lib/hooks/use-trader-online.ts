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
  const lastHeartbeat = status.last_heartbeat;
  const isClient = useIsClient();
  // Server/hydration render uses the heartbeat time as "now"; on the client re-check every second
  // but only re-render callers when the online state actually flips.
  const [online, setOnline] = useState(() =>
    isTraderOnline(lastHeartbeat, getStableDisplayNow(lastHeartbeat)),
  );

  useEffect(() => {
    if (!isClient) return;
    const tick = () => setOnline(isTraderOnline(lastHeartbeat));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isClient, lastHeartbeat]);

  return online;
}

/** Live trader online state (prefers shared bot_status from DashboardShell). */
export function useTraderOnline(fallbackStatus?: BotStatus | null): boolean {
  const fromProvider = useContext(BotStatusContext);
  const status = fromProvider ?? fallbackStatus ?? offlineFallback;
  return useTraderOnlineFromStatus(status);
}
