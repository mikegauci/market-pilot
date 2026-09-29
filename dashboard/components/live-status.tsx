"use client";

import { StatusBadges } from "@/components/status-badges";
import { useLiveBotStatus } from "@/components/bot-status-provider";

export function LiveStatus({ variant = "default" }: { variant?: "default" | "sidebar" }) {
  const status = useLiveBotStatus();
  return <StatusBadges status={status} variant={variant} />;
}
