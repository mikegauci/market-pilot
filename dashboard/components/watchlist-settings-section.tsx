"use client";

import { useState } from "react";
import { WatchlistCharts } from "@/components/watchlist-charts";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { FieldDescription } from "@/components/settings-section";
import type { Settings } from "@/lib/types/database";
import {
  formatPredictingWatchlistHeadline,
  resolveEffectiveWatchlist,
} from "@/lib/effective-watchlist";

type Props = {
  settings: Settings;
};

export function WatchlistSettingsSection({ settings }: Props) {
  const [chartSymbol, setChartSymbol] = useState<string | undefined>(undefined);
  const effectiveWatchlist = resolveEffectiveWatchlist(settings);
  const headline = formatPredictingWatchlistHeadline(effectiveWatchlist.length);

  function selectChartSymbol(symbol: string) {
    setChartSymbol(symbol.toUpperCase());
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="benchmark_symbol" value="" />

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 p-3">
        <p className="text-sm font-medium text-zinc-100">{headline}</p>
        <p className="mt-1 text-xs text-zinc-500">
          These are the symbols Jev monitors for entries. Open positions are added at runtime.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {effectiveWatchlist.length ? (
            effectiveWatchlist.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => selectChartSymbol(symbol)}
                className="rounded border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-200 hover:border-emerald-700/60 hover:text-emerald-300"
              >
                {symbol}
              </button>
            ))
          ) : (
            <span className="text-xs text-zinc-500">—</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <WatchlistPicker
          inputName="watchlist"
          defaultValue={settings.watchlist?.length ? settings.watchlist : []}
          fieldLabel="Watchlist symbols"
        />
        <FieldDescription title="Comma-separated tickers the bot evaluates for new trades (plus any open positions for exits).">
          Save to apply.
        </FieldDescription>
      </div>

      <WatchlistCharts
        symbols={effectiveWatchlist}
        selectedSymbol={chartSymbol}
        onSelectedSymbolChange={selectChartSymbol}
      />
    </div>
  );
}
