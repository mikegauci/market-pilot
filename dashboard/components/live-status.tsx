"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { StatusBadges } from "@/components/status-badges";
import type { BotStatus } from "@/lib/types/database";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";

export function LiveStatus({ status }: { status: BotStatus }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeRefresh(["bot_status"], refresh);
  return <StatusBadges status={status} />;
}
