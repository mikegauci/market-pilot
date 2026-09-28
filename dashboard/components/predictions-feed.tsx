"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { Prediction } from "@/lib/types/database";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/utils";

export function PredictionsFeed({ predictions }: { predictions: Prediction[] }) {
  const router = useRouter();
  const [symbolFilter, setSymbolFilter] = useState("");
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeRefresh(["predictions"], refresh);

  const symbols = [...new Set(predictions.map((p) => p.symbol))].sort();
  const filtered = symbolFilter
    ? predictions.filter((p) => p.symbol === symbolFilter)
    : predictions;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Latest Predictions</CardTitle>
        <select
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
        >
          <option value="">All symbols</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No predictions yet</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Symbol</th>
                <th className="pb-2 pr-3">Price</th>
                <th className="pb-2 pr-3">BUY</th>
                <th className="pb-2 pr-3">HOLD</th>
                <th className="pb-2 pr-3">SELL</th>
                <th className="pb-2">Trade</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-3 text-zinc-400">{formatDateTime(p.timestamp)}</td>
                  <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                  <td className="py-2 pr-3">{formatCurrency(p.price)}</td>
                  <td className="py-2 pr-3 text-emerald-400">{formatPercent(p.buy_probability)}</td>
                  <td className="py-2 pr-3 text-zinc-300">{formatPercent(p.hold_probability)}</td>
                  <td className="py-2 pr-3 text-red-400">{formatPercent(p.sell_probability)}</td>
                  <td className="py-2">
                    {p.trade_created ? (
                      <Badge className="bg-emerald-900 text-emerald-300">opened</Badge>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
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
