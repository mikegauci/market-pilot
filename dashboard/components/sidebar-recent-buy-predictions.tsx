"use client";

import Link from "next/link";
import { useCallback } from "react";
import { fetchRecentPredictions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { LIVE_PREDICTIONS_POLL_MS } from "@/lib/live-data-config";
import {
  formatJevProbabilityPercent,
  formatSkipReason,
  isPreJevFilterSkip,
} from "@/lib/prediction-skip-reason";
import type { Prediction } from "@/lib/types/database";
import { cn, formatCurrency, formatTimeHms } from "@/lib/utils";

const WINDOW_MINUTES = 2;
const ROW_LIMIT = 30;

function SidebarOutcome({ prediction }: { prediction: Prediction }) {
  if (prediction.trade_created) {
    return <span className="font-medium text-emerald-400/90">opened</span>;
  }

  const label = formatSkipReason(prediction.trade_skip_reason);
  if (!label) {
    return <span className="text-zinc-600">—</span>;
  }

  const isWaiting = label.startsWith("Awaiting confirmation");
  return (
    <span
      className={cn(
        "line-clamp-2 leading-tight",
        isWaiting ? "text-amber-400/90" : "text-zinc-500",
      )}
      title={prediction.trade_skip_reason ?? label}
    >
      {label}
    </span>
  );
}

export function SidebarRecentBuyPredictions() {
  const load = useCallback(
    () => fetchRecentPredictions(WINDOW_MINUTES, ROW_LIMIT),
    [],
  );
  const rows = useLiveQuery([] as Prediction[], load, ["predictions"], LIVE_PREDICTIONS_POLL_MS, {
    keepPreviousOnEmpty: true,
  });

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Predictions · last {WINDOW_MINUTES}m
        </p>
        <Link
          href="/predictions"
          className="text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
        >
          Full feed
        </Link>
      </div>
      <p className="mt-1 text-[10px] text-zinc-600">
        B/H/S are Jev only. Dashes mean entry filters blocked before Jev ran — see Outcome.
      </p>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No evals in the last {WINDOW_MINUTES} minutes</p>
      ) : (
        <div className="mt-2 max-h-56 overflow-auto pr-0.5">
          <table className="w-full table-fixed text-[10px]">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-600">
                <th className="pb-1 pr-1 font-medium w-[3.25rem]">Time</th>
                <th className="pb-1 pr-1 font-medium w-[2.25rem]">Sym</th>
                <th className="pb-1 pr-1 font-medium w-[2.75rem] text-right">Px</th>
                <th className="pb-1 pr-0.5 font-medium w-[1.6rem] text-right">B</th>
                <th className="pb-1 pr-0.5 font-medium w-[1.75rem] text-right">H</th>
                <th className="pb-1 pr-1 font-medium w-[1.75rem] text-right">S</th>
                <th className="pb-1 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/40 align-top">
                  <td className="py-1 pr-1 tabular-nums text-zinc-500">{formatTimeHms(p.timestamp)}</td>
                  <td className="py-1 pr-1 font-medium text-zinc-200">{p.symbol}</td>
                  <td className="py-1 pr-1 text-right tabular-nums text-zinc-400">
                    {formatCurrency(p.price)}
                  </td>
                  <td
                    className={cn(
                      "py-1 pr-0.5 text-right tabular-nums",
                      isPreJevFilterSkip(p) ? "text-zinc-600" : "text-emerald-400/90",
                    )}
                  >
                    {formatJevProbabilityPercent(p.buy_probability, p)}
                  </td>
                  <td
                    className={cn(
                      "py-1 pr-0.5 text-right tabular-nums",
                      isPreJevFilterSkip(p) ? "text-zinc-600" : "text-zinc-400",
                    )}
                  >
                    {formatJevProbabilityPercent(p.hold_probability, p)}
                  </td>
                  <td
                    className={cn(
                      "py-1 pr-1 text-right tabular-nums",
                      isPreJevFilterSkip(p) ? "text-zinc-600" : "text-red-400/80",
                    )}
                  >
                    {formatJevProbabilityPercent(p.sell_probability, p)}
                  </td>
                  <td className="py-1 min-w-0">
                    <SidebarOutcome prediction={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
