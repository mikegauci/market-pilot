"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { Prediction } from "@/lib/types/database";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/utils";

type SortKey =
  | "timestamp"
  | "symbol"
  | "price"
  | "buy_probability"
  | "hold_probability"
  | "sell_probability"
  | "trade_created";
type SortDir = "asc" | "desc";

function comparePredictions(a: Prediction, b: Prediction, key: SortKey): number {
  switch (key) {
    case "timestamp":
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    case "symbol":
      return a.symbol.localeCompare(b.symbol);
    case "price":
      return a.price - b.price;
    case "buy_probability":
      return a.buy_probability - b.buy_probability;
    case "hold_probability":
      return a.hold_probability - b.hold_probability;
    case "sell_probability":
      return a.sell_probability - b.sell_probability;
    case "trade_created":
      return Number(a.trade_created) - Number(b.trade_created);
  }
}

export function PredictionsFeed({ predictions }: { predictions: Prediction[] }) {
  const router = useRouter();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeRefresh(["predictions"], refresh);

  const symbols = [...new Set(predictions.map((p) => p.symbol))].sort();
  const filtered = symbolFilter
    ? predictions.filter((p) => p.symbol === symbolFilter)
    : predictions;

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const cmp = comparePredictions(a, b, sortKey);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  }

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
                {(
                  [
                    ["Time", "timestamp"],
                    ["Symbol", "symbol"],
                    ["Price", "price"],
                    ["BUY", "buy_probability"],
                    ["HOLD", "hold_probability"],
                    ["SELL", "sell_probability"],
                    ["Trade", "trade_created"],
                  ] as const
                ).map(([label, key], i, arr) => (
                  <th key={key} className={`pb-2 ${i < arr.length - 1 ? "pr-3" : ""}`}>
                    <button
                      type="button"
                      onClick={() => handleSort(key)}
                      className="inline-flex items-center gap-1 hover:text-zinc-300"
                    >
                      {label}
                      {sortKey === key &&
                        (sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        ))}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
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
