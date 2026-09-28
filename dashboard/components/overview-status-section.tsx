"use client";

import { BotStatusProvider } from "@/components/bot-status-provider";
import { LiveStatus } from "@/components/live-status";
import { TradingControls } from "@/components/trading-controls";
import type { BotStatus } from "@/lib/types/database";

export function OverviewStatusSection({ botStatus }: { botStatus: BotStatus }) {
  return (
    <BotStatusProvider initialStatus={botStatus}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <LiveStatus />
        <TradingControls />
      </div>
    </BotStatusProvider>
  );
}
