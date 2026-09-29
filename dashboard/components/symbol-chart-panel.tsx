"use client";

import { useEffect, useState } from "react";
import { SymbolChart } from "@/components/symbol-chart";
import { fetchSymbolBars } from "@/lib/data-client";
import type { ChartMarker, ChartOverlayLine, SymbolBar } from "@/lib/types/database";

type Props = {
  symbol: string;
  barSize?: string;
  overlays?: ChartOverlayLine[];
  markers?: ChartMarker[];
  height?: number;
};

export function SymbolChartPanel({
  symbol,
  barSize = "5 mins",
  overlays = [],
  markers = [],
  height = 240,
}: Props) {
  const [bars, setBars] = useState<SymbolBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSymbolBars(symbol, barSize);
        if (!cancelled) {
          setBars(data);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load chart data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [symbol, barSize]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center text-sm text-zinc-500"
        style={{ height }}
      >
        Loading chart…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-8 text-center text-sm text-red-400">{error}</p>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      <p className="mb-2 text-xs font-medium text-zinc-400">
        {symbol} · {barSize}
      </p>
      <SymbolChart bars={bars} overlays={overlays} markers={markers} height={height} />
    </div>
  );
}
