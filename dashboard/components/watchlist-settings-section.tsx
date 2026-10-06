"use client";

import { useMemo, useState } from "react";
import { EntryBlockedSymbols } from "@/components/entry-blocked-symbols";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { FieldDescription } from "@/components/settings-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "@/lib/types/database";
import {
  formatPredictingWatchlistHeadline,
  resolveEffectiveWatchlist,
} from "@/lib/effective-watchlist";
import {
  normalizeWatchlistSymbols,
  watchlistSymbolsHiddenValue,
} from "@/lib/watchlist-symbols";

type Props = {
  settings: Settings;
};

export function WatchlistSettingsSection({ settings }: Props) {
  const [rotating, setRotating] = useState(Boolean(settings.watchlist_rotation_enabled));
  const [poolSymbols, setPoolSymbols] = useState(() =>
    normalizeWatchlistSymbols(settings.watchlist_pool ?? []),
  );
  const [manualWatchlist, setManualWatchlist] = useState(() =>
    normalizeWatchlistSymbols(settings.watchlist ?? []),
  );

  const previewSettings = useMemo(
    (): Settings => ({
      ...settings,
      watchlist_rotation_enabled: rotating,
      watchlist_pool: poolSymbols,
      watchlist: manualWatchlist,
    }),
    [settings, rotating, poolSymbols, manualWatchlist],
  );

  const effectiveWatchlist = resolveEffectiveWatchlist(previewSettings);
  const headline = formatPredictingWatchlistHeadline(effectiveWatchlist.length);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="benchmark_symbol">Benchmark</Label>
        <Input
          id="benchmark_symbol"
          name="benchmark_symbol"
          defaultValue={settings.benchmark_symbol ?? ""}
          placeholder="QQQ"
          className="max-w-[10rem] font-mono uppercase"
        />
        <FieldDescription title="Used only to see if the market is a headwind. The bot does not buy this symbol.">
          QQQ fits a tech book. Leave blank to turn the headwind check off.
        </FieldDescription>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          name="watchlist_rotation_enabled"
          value="on"
          checked={rotating}
          onChange={(e) => setRotating(e.target.checked)}
          className="rounded border-zinc-700"
        />
        Rotate the active list through the session
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="watchlist_active_size">Active list size</Label>
          <Input
            id="watchlist_active_size"
            name="watchlist_active_size"
            type="number"
            min={1}
            max={20}
            defaultValue={settings.watchlist_active_size ?? 12}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="watchlist_rotation_interval_minutes">Minutes between swaps</Label>
          <Input
            id="watchlist_rotation_interval_minutes"
            name="watchlist_rotation_interval_minutes"
            type="number"
            min={5}
            max={120}
            defaultValue={settings.watchlist_rotation_interval_minutes ?? 15}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="watchlist_max_swaps_per_rotation">Max swaps</Label>
          <Input
            id="watchlist_max_swaps_per_rotation"
            name="watchlist_max_swaps_per_rotation"
            type="number"
            min={1}
            max={5}
            defaultValue={settings.watchlist_max_swaps_per_rotation ?? 2}
          />
        </div>
      </div>
      <FieldDescription title="Jev only checks the active list. The rest of the pool is watched for the next swap.">
        A challenger has to clearly beat the weakest active name. Open trades stay on the list.
      </FieldDescription>

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 p-3">
        <p className="text-sm font-medium text-zinc-100">{headline}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {rotating
            ? "These are the names Jev is checking now. The bot updates this list."
            : "These are the symbols Jev monitors for entries. Open positions are added at runtime."}
        </p>
        {settings.watchlist_last_rotation_note ? (
          <p className="mt-1 text-xs text-zinc-400">
            Last change: {settings.watchlist_last_rotation_note}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {effectiveWatchlist.length ? (
            effectiveWatchlist.map((symbol) => (
              <span
                key={symbol}
                className="rounded border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-200"
              >
                {symbol}
              </span>
            ))
          ) : (
            <span className="text-xs text-zinc-500">—</span>
          )}
        </div>
      </div>

      <input
        type="hidden"
        name="watchlist"
        value={watchlistSymbolsHiddenValue(manualWatchlist)}
        required={!rotating}
      />
      <input
        type="hidden"
        name="watchlist_pool"
        value={watchlistSymbolsHiddenValue(poolSymbols)}
        required={rotating}
      />

      <EntryBlockedSymbols symbols={settings.entry_blocked_symbols ?? []} />

      {rotating ? (
        <div className="space-y-2">
          <WatchlistPicker
            value={poolSymbols}
            onChange={setPoolSymbols}
            fieldLabel="Candidate pool"
          />
          <FieldDescription title="The larger list rotation chooses from. About 30 liquid names is enough.">
            QQQ itself stays the benchmark and is not traded.
          </FieldDescription>
        </div>
      ) : (
        <div className="space-y-2">
          <WatchlistPicker
            value={manualWatchlist}
            onChange={setManualWatchlist}
            fieldLabel="Watchlist"
          />
          <FieldDescription title="Symbols Jev monitors for entries when rotation is off.">
            Save to apply.
          </FieldDescription>
        </div>
      )}
    </div>
  );
}
