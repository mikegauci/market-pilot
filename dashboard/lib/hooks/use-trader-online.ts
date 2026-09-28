"use client";

import { useBotStatus } from "@/lib/hooks/use-bot-status";
import { isTraderOnline } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";

/** Live trader online state (polls bot_status heartbeat). */
export function useTraderOnline(initialStatus: BotStatus): boolean {
  const status = useBotStatus(initialStatus);
  return isTraderOnline(status.last_heartbeat);
}
