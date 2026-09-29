"use client";

import { useState } from "react";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Card, CardTitle } from "@/components/ui/card";

type Props = {
  symbols: string[];
};

export function WatchlistCharts({ symbols }: Props) {
  const sorted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  const [selected, setSelected] = useState(sorted[0] ?? "");

  if (sorted.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardTitle>Watchlist charts</CardTitle>
      <p className="mt-1 text-xs text-zinc-500">
        Intraday price action for symbols on your effective watchlist.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Symbol
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
          >
            {sorted.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected ? (
        <div className="mt-4">
          <SymbolChartPanel symbol={selected} />
        </div>
      ) : null}
    </Card>
  );
}
