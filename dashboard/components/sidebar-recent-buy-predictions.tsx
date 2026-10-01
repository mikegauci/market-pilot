"use client";

import Link from "next/link";
import { useCallback } from "react";
import { fetchRecentTopBuyPredictions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { Prediction } from "@/lib/types/database";
import { formatDateTime, formatPercent } from "@/lib/utils";

const WINDOW_MINUTES = 5;
const TOP_LIMIT = 8;

export function SidebarRecentBuyPredictions() {
  const load = useCallback(() => fetchRecentTopBuyPredictions(WINDOW_MINUTES, TOP_LIMIT), []);
  const rows = useLiveQuery([] as Prediction[], load, ["predictions"]);

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Top BUY · last {WINDOW_MINUTES}m
        </p>
        <Link
          href="/predictions"
          className="text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
        >
          All
        </Link>
      </div>
      <p className="mt-1 text-[10px] text-zinc-600">
        Highest Jev BUY % among recent evals (BUY beats hold and sell).
      </p>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No strong BUY signals in this window</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-0.5">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
              <div className="min-w-0">
                <span className="font-medium text-zinc-200">{p.symbol}</span>
                <span className="ml-1.5 truncate text-[10px] text-zinc-600">
                  {formatDateTime(p.timestamp)}
                </span>
              </div>
              <span className="shrink-0 tabular-nums font-medium text-emerald-400/90">
                {formatPercent(p.buy_probability)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
