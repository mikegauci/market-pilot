"use client";

import { useMemo, useState } from "react";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  symbols: string[];
  extraSymbols?: string[];
  nested?: boolean;
  className?: string;
  selectedSymbol?: string;
  onSelectedSymbolChange?: (symbol: string) => void;
};

function mergeSymbols(symbols: string[], extraSymbols?: string[]): string[] {
  const merged = [...symbols, ...(extraSymbols ?? [])];
  return [...new Set(merged.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
}

export function WatchlistCharts({
  symbols,
  extraSymbols,
  nested = false,
  className,
  selectedSymbol: selectedSymbolProp,
  onSelectedSymbolChange,
}: Props) {
  const sorted = useMemo(
    () => mergeSymbols(symbols, extraSymbols),
    [symbols, extraSymbols],
  );
  const [internalSelected, setInternalSelected] = useState(sorted[0] ?? "");
  const isControlled = selectedSymbolProp !== undefined;

  if (
    !isControlled &&
    sorted.length > 0 &&
    !sorted.includes(internalSelected)
  ) {
    setInternalSelected(sorted[0]);
  }

  const selected = isControlled ? selectedSymbolProp : internalSelected;

  function handleChange(symbol: string) {
    if (isControlled) {
      onSelectedSymbolChange?.(symbol);
    } else {
      setInternalSelected(symbol);
    }
  }

  if (sorted.length === 0) {
    return null;
  }

  const effectiveSelected = sorted.includes(selected) ? selected : sorted[0];

  const content = (
    <>
      {!nested ? (
        <>
          <CardTitle>Watchlist charts</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Intraday price action for watchlist and EM universe symbols.
          </p>
        </>
      ) : (
        <p className="text-xs text-zinc-500">
          Pick a watchlist or EM holding symbol to preview intraday price action.
        </p>
      )}

      <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", nested ? "mt-3" : "mt-4")}>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Symbol
          <select
            value={effectiveSelected}
            onChange={(e) => handleChange(e.target.value)}
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

      {effectiveSelected ? (
        <div className={nested ? "mt-3" : "mt-4"}>
          <SymbolChartPanel symbol={effectiveSelected} />
        </div>
      ) : null}
    </>
  );

  if (nested) {
    return <div className={cn(className)}>{content}</div>;
  }

  return <Card className={className}>{content}</Card>;
}
