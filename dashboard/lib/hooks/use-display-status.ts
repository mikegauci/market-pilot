"use client";

import { useEffect, useState } from "react";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { getMarketStatus, type MarketStatus } from "@/lib/market-hours";
import { getDisplayStatus, getStableDisplayNow } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";

/**
 * Trader display status and market status, re-evaluated every second on the client.
 * Server render uses the heartbeat time as "now" so hydration matches; `market` is null until mounted.
 */
export function useLiveDisplayStatus(status: BotStatus) {
  const isClient = useIsClient();
  const [display, setDisplay] = useState(() =>
    getDisplayStatus(status, getStableDisplayNow(status.last_heartbeat)),
  );
  const [market, setMarket] = useState<MarketStatus | null>(null);

  useEffect(() => {
    if (!isClient) return;
    const tick = () => {
      setDisplay(getDisplayStatus(status));
      setMarket(getMarketStatus());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isClient, status]);

  return { isClient, display, market };
}
