"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getMarketStatus, type MarketStatus } from "@/lib/market-hours";

export function MarketClock() {
  const [status, setStatus] = useState<MarketStatus | null>(null);

  useEffect(() => {
    setStatus(getMarketStatus());
    const id = setInterval(() => setStatus(getMarketStatus()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/80 p-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${status?.isOpen ? "bg-emerald-400" : "bg-zinc-500"}`}
          aria-hidden
        />
        <Badge
          className={
            status?.isOpen
              ? "bg-emerald-900 text-emerald-300"
              : "bg-zinc-800 text-zinc-400"
          }
        >
          {status ? (status.isOpen ? "Market Open" : "Market Closed") : "Market —"}
        </Badge>
      </div>
      <p className="mt-2 font-mono text-sm tabular-nums text-zinc-200">
        {status?.timeMalta ?? "—:—:— Malta"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{status?.sessionLabel ?? "Loading…"}</p>
    </div>
  );
}
