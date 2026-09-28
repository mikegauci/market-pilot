"use client";

import { StatusBadges } from "@/components/status-badges";
import { useLiveBotStatus } from "@/components/bot-status-provider";

export function LiveStatus() {
  const status = useLiveBotStatus();
  return <StatusBadges status={status} />;
}
