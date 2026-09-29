"use client";

import { useEffect, useState } from "react";
import { useBotStatus } from "@/lib/hooks/use-bot-status";
import { getStableDisplayNow, isTraderOnline } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";

/** Live trader online state (polls bot_status heartbeat). */
export function useTraderOnline(initialStatus: BotStatus): boolean {
  const status = useBotStatus(initialStatus);
  const stableNow = getStableDisplayNow(status.last_heartbeat);
  const [mounted, setMounted] = useState(false);
  const [traderOnline, setTraderOnline] = useState(() =>
    isTraderOnline(status.last_heartbeat, stableNow),
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const update = () => setTraderOnline(isTraderOnline(status.last_heartbeat));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status.last_heartbeat, mounted]);

  return traderOnline;
}
