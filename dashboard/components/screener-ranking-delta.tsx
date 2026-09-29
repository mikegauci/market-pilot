"use client";

import { ClientDateTime } from "@/components/client-date-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import {
  computeRankingDeltas,
  droppedSymbolsInScan,
  newSymbolsInScan,
} from "@/lib/screener-ranking-delta";
import type { WatchlistScreenerHistory } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  history: WatchlistScreenerHistory[];
};

export function ScreenerRankingDelta({ history }: Props) {
  const [current, previous] = history;

  if (!current) {
    return (
      <Card>
        <CardTitle>Screener ranking history</CardTitle>
        <p className="mt-3 text-sm text-zinc-500">
          No screener history yet — rankings are logged on each successful EM scan.
        </p>
      </Card>
    );
  }

  const deltas = computeRankingDeltas(current, previous ?? null);
  const newcomers = newSymbolsInScan(current, previous ?? null);
  const dropped = droppedSymbolsInScan(current, previous ?? null);

  return (
    <Card>
      <CardTitle>Screener ranking changes</CardTitle>
      <p className="mt-1 text-xs text-zinc-600">
        Latest scan <ClientDateTime value={current.ran_at} />
        {previous ? (
          <>
            {" · vs "}
            <ClientDateTime value={previous.ran_at} />
          </>
        ) : (
          " · first recorded scan"
        )}
      </p>

      {(newcomers.length > 0 || dropped.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {newcomers.map((sym) => (
            <Badge key={`new-${sym}`} className="bg-emerald-900/50 text-emerald-300">
              +{sym}
            </Badge>
          ))}
          {dropped.map((sym) => (
            <Badge key={`drop-${sym}`} className="bg-red-900/40 text-red-300">
              −{sym}
            </Badge>
          ))}
        </div>
      )}

      {deltas.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No rankings in latest scan</p>
      ) : (
        <div className="mt-3 max-h-56 overflow-y-auto rounded border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
              <tr>
                <th className="px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">Symbol</th>
                <th className="px-2 py-1 text-right">Δ rank</th>
                <th className="px-2 py-1 text-right">BUY</th>
              </tr>
            </thead>
            <tbody>
              {deltas.slice(0, 20).map((row) => (
                <tr key={row.symbol} className="border-t border-zinc-900">
                  <td className="px-2 py-1 text-zinc-500">{row.currentRank}</td>
                  <td className="px-2 py-1">{row.symbol}</td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right tabular-nums",
                      row.delta == null
                        ? "text-zinc-600"
                        : row.delta > 0
                          ? "text-emerald-400"
                          : row.delta < 0
                            ? "text-red-400"
                            : "text-zinc-500",
                    )}
                  >
                    {row.delta == null ? "new" : row.delta > 0 ? `+${row.delta}` : row.delta}
                  </td>
                  <td className="px-2 py-1 text-right text-emerald-400">
                    {Math.round(row.buy * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
