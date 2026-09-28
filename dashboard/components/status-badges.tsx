"use client";

import { useEffect, useState } from "react";
import { getMarketStatus, type MarketStatus } from "@/lib/market-hours";
import { getDisplayStatus, getStableDisplayNow } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

export function StatusBadges({ status }: { status: BotStatus }) {
  const stableNow = getStableDisplayNow(status.last_heartbeat);
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState(() => getDisplayStatus(status, stableNow));
  const [market, setMarket] = useState<MarketStatus | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const update = () => {
      setDisplay(getDisplayStatus(status));
      setMarket(getMarketStatus());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, mounted]);

  return (
    <StatusPanel
      status={status}
      display={display}
      market={market}
      showLiveTimes={mounted}
    />
  );
}

function StatusDot({ active, tone = "emerald" }: { active: boolean; tone?: "emerald" | "blue" | "purple" | "teal" }) {
  const colors = {
    emerald: active ? "bg-emerald-400 shadow-emerald-400/50" : "bg-zinc-600",
    blue: active ? "bg-blue-400 shadow-blue-400/50" : "bg-zinc-600",
    purple: active ? "bg-purple-400 shadow-purple-400/50" : "bg-zinc-600",
    teal: active ? "bg-teal-400 shadow-teal-400/50" : "bg-zinc-600",
  };

  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        active && "shadow-[0_0_6px_1px]",
        colors[tone],
      )}
      aria-hidden
    />
  );
}

function StatusItem({
  label,
  value,
  active,
  tone = "emerald",
}: {
  label: string;
  value: string;
  active: boolean;
  tone?: "emerald" | "blue" | "purple" | "teal";
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5">
      <StatusDot active={active} tone={tone} />
      <div className="min-w-0">
        <p className="text-xs text-zinc-500">{label}</p>
        <p className={cn("text-sm font-medium", active ? "text-zinc-100" : "text-zinc-400")}>
          {value}
        </p>
      </div>
    </div>
  );
}

function StatusPanel({
  status,
  display,
  market,
  showLiveTimes,
}: {
  status: BotStatus;
  display: ReturnType<typeof getDisplayStatus>;
  market: MarketStatus | null;
  showLiveTimes: boolean;
}) {
  const isIbkrExecution = (status.execution_mode ?? "simulated") === "ibkr";
  const signalsPaused = market && !market.isOpen && display.traderOnline;
  const signalsActive = display.jevConnected;
  const signalsLabel = signalsActive
    ? "Analyzing"
    : signalsPaused
      ? "Paused — market closed"
      : display.traderOnline
        ? "Waiting"
        : "Unavailable";

  return (
    <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">System status</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                market?.isOpen ? "bg-emerald-400 shadow-[0_0_8px_2px] shadow-emerald-400/40" : "bg-zinc-500",
              )}
              aria-hidden
            />
            <p className="text-base font-medium text-zinc-100">
              {!showLiveTimes
                ? "Checking market…"
                : market
                  ? market.isOpen
                    ? "US market is open"
                    : "US market is closed"
                  : "Checking market…"}
            </p>
          </div>
          {showLiveTimes && market && (
            <p className="mt-1 text-xs text-zinc-500">{market.sessionLabel}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">Last update</p>
          <p className="text-sm text-zinc-300" suppressHydrationWarning>
            {showLiveTimes ? display.heartbeatLabel : "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <StatusItem
          label="Auto-trading"
          value={status.enabled ? "On" : "Off"}
          active={status.enabled}
          tone="emerald"
        />
        <StatusItem
          label="Trading engine"
          value={display.traderOnline ? "Running" : "Not running"}
          active={display.traderOnline}
          tone="teal"
        />
        <StatusItem
          label="Broker connection"
          value={display.ibkrConnected ? "Connected" : "Not connected"}
          active={display.ibkrConnected}
          tone="blue"
        />
        <StatusItem
          label="AI signals"
          value={signalsLabel}
          active={signalsActive}
          tone="purple"
        />
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Trade mode:{" "}
        <span className="text-zinc-400">
          {isIbkrExecution ? "Orders sent to paper broker" : "Practice — tracked in dashboard only"}
        </span>
      </p>

      {status.last_error && (
        <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {status.last_error}
        </p>
      )}
    </div>
  );
}
