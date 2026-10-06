"use client";

import { createContext, useContext } from "react";
import { useBotStatus } from "@/lib/hooks/use-bot-status";
import type { BotStatus } from "@/lib/types/database";

export const BotStatusContext = createContext<BotStatus | null>(null);

export function BotStatusProvider({
  initialStatus,
  children,
}: {
  initialStatus: BotStatus;
  children: React.ReactNode;
}) {
  const status = useBotStatus(initialStatus);
  return (
    <BotStatusContext.Provider value={status}>{children}</BotStatusContext.Provider>
  );
}

export function useLiveBotStatus(): BotStatus {
  const status = useContext(BotStatusContext);
  if (!status) {
    throw new Error("useLiveBotStatus must be used within BotStatusProvider");
  }
  return status;
}
