"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { WatchlistCharts } from "@/components/watchlist-charts";
import { WatchlistPicker } from "@/components/watchlist-picker";
import {
  FieldDescription,
  SettingsCollapsible,
  SettingsField,
  SettingsFieldGroup,
} from "@/components/settings-section";
import type { EmUniverseRow, Settings } from "@/lib/types/database";
import {
  formatWatchlistScanStatus,
  resolveEffectiveWatchlist,
  resolveWatchlistScanStatus,
} from "@/lib/effective-watchlist";
import { cn, formatDateTimeFull } from "@/lib/utils";

type EmUniverseStats = {
  count: number;
  tradableCount: number;
  topHoldings: EmUniverseRow[];
};

type Props = {
  settings: Settings;
  emUniverse: EmUniverseStats;
};

export function WatchlistSettingsSection({ settings, emUniverse }: Props) {
  const [dynamicEnabled, setDynamicEnabled] = useState(
    settings.watchlist_dynamic_enabled ?? true,
  );
  const emSymbols = emUniverse.topHoldings.map((row) => row.symbol);
  const [chartSymbol, setChartSymbol] = useState<string | undefined>(undefined);
  const chartAnchorRef = useRef<HTMLDivElement>(null);

  const coreDefault =
    settings.watchlist_core?.length ? settings.watchlist_core : settings.watchlist;
  const effectiveWatchlist = resolveEffectiveWatchlist(settings);
  const scanStatus = resolveWatchlistScanStatus(settings);
  const fallbackLabel = dynamicEnabled ? "Fallback symbols" : "Always-on symbols";

  function selectChartSymbol(symbol: string) {
    setChartSymbol(symbol.toUpperCase());
    chartAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="benchmark_symbol" value="EEM" />

      <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/30 p-3">
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            name="watchlist_dynamic_enabled"
            checked={dynamicEnabled}
            onChange={(e) => setDynamicEnabled(e.target.checked)}
            className="mt-0.5 rounded border-zinc-700"
          />
          <span>
            <span className="font-medium">Enable Jev dynamic EM watchlist</span>
            <span className="mt-1 block text-xs font-normal text-zinc-500">
              {dynamicEnabled
                ? "After Save, the trader trades top-N EM picks from each successful scan (see interval below). Fallback symbols apply only until the first successful scan, or if that first scan fails. Later scan failures keep the last good list."
                : "Bot watches only your always-on symbols. Save to apply."}
            </span>
          </span>
        </label>
      </div>

      <div className={cn(dynamicEnabled && "opacity-75")}>
        <WatchlistPicker
          inputName="watchlist_core"
          defaultValue={coreDefault}
          fieldLabel={fallbackLabel}
        />
        <FieldDescription
          title={
            dynamicEnabled
              ? "Fallback when dynamic is on and no successful scan yet, or the first scan fails."
              : "Required when dynamic mode is off."
          }
        >
          {dynamicEnabled
            ? "Not traded after a successful scan — kept here in case the first scan fails or dynamic mode is turned off."
            : "Symbols the bot watches when dynamic mode is off."}
        </FieldDescription>
      </div>

      <SettingsFieldGroup className={cn(!dynamicEnabled && "opacity-60")}>
        <SettingsField
          id="watchlist_dynamic_size"
          label="Dynamic top-N"
          description="EM symbols the trader watches after each successful scan."
          descriptionTitle="How many top-ranked EM symbols replace the always-on list after each scan."
        >
          <Input
            id="watchlist_dynamic_size"
            name="watchlist_dynamic_size"
            type="number"
            min={0}
            max={20}
            defaultValue={settings.watchlist_dynamic_size ?? 5}
          />
        </SettingsField>
        <SettingsField
          id="watchlist_refresh_minutes"
          label="Jev scan interval (min)"
          description="Minutes between full EM universe rescans."
          descriptionTitle="How often Jev re-scores the full EM universe."
        >
          <Input
            id="watchlist_refresh_minutes"
            name="watchlist_refresh_minutes"
            type="number"
            min={5}
            max={240}
            defaultValue={settings.watchlist_refresh_minutes ?? 30}
          />
        </SettingsField>
      </SettingsFieldGroup>

      <p className="text-xs text-zinc-500">
        Benchmark:{" "}
        <span className="font-medium text-zinc-300">EEM</span>
        {" — "}
        used for broad-market headwind checks and Jev context.
      </p>

      <div>
        <p className="text-sm font-medium text-zinc-200">Effective watchlist</p>
        <p className="mt-1 text-xs text-zinc-500">
          {scanStatus.mode === "last_scan" ? (
            <>
              Using last scan ({formatDateTimeFull(scanStatus.ranAt)}
              ) — failed rescans keep this list until the next success.
            </>
          ) : (
            formatWatchlistScanStatus(scanStatus)
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          {effectiveWatchlist.join(", ") || "—"}
        </p>
        <FieldDescription title="Symbols the trader evaluates now (plus open positions and EEM at runtime).">
          Dynamic top-N after a successful scan; always-on fallback only before the first
          successful scan or if that first scan fails.
        </FieldDescription>
      </div>

      <div ref={chartAnchorRef}>
        <p className="text-sm font-medium text-zinc-200">Intraday charts</p>
        <WatchlistCharts
          nested
          symbols={effectiveWatchlist}
          extraSymbols={emSymbols}
          selectedSymbol={chartSymbol}
          onSelectedSymbolChange={setChartSymbol}
          className="mt-2"
        />
      </div>

      {(settings.watchlist_jev_rankings?.length ?? 0) > 0 && (
        <SettingsCollapsible summary="Last Jev universe scan">
          <p className="mb-2 text-xs text-zinc-500">
            {settings.watchlist_screener_ran_at
              ? formatDateTimeFull(settings.watchlist_screener_ran_at)
              : "Unknown time"}
          </p>
          <div className="max-h-48 overflow-y-auto rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">Symbol</th>
                  <th className="px-2 py-1 text-right">BUY</th>
                  <th className="px-2 py-1 text-right">HOLD</th>
                  <th className="px-2 py-1 text-right">SELL</th>
                </tr>
              </thead>
              <tbody>
                {settings.watchlist_jev_rankings.slice(0, 15).map((row) => (
                  <tr key={row.symbol} className="border-t border-zinc-900">
                    <td className="px-2 py-1 text-zinc-500">{row.rank}</td>
                    <td className="px-2 py-1">{row.symbol}</td>
                    <td className="px-2 py-1 text-right text-emerald-400">
                      {Math.round(row.buy * 100)}%
                    </td>
                    <td className="px-2 py-1 text-right text-zinc-400">
                      {Math.round(row.hold * 100)}%
                    </td>
                    <td className="px-2 py-1 text-right text-red-400">
                      {Math.round(row.sell * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsCollapsible>
      )}

      <SettingsCollapsible summary="EM universe (EEM + IEMG holdings)">
        <p className="text-xs leading-relaxed text-zinc-400">
          {emUniverse.tradableCount > 0 ? (
            <>
              {emUniverse.tradableCount} tradable US-listed symbol
              {emUniverse.tradableCount === 1 ? "" : "s"}
              {settings.em_universe_synced_at
                ? ` · last sync ${formatDateTimeFull(settings.em_universe_synced_at)}`
                : ""}
              {settings.em_universe_source ? ` · source ${settings.em_universe_source}` : ""}
              {" · "}
              Universe syncs weekly from EEM + IEMG holdings.
            </>
          ) : (
            <>
              No synced universe in Supabase yet — trader falls back to local JSON. Universe
              syncs weekly from EEM + IEMG holdings.
            </>
          )}
        </p>
        {emUniverse.topHoldings.length > 0 && (
          <div className="mt-3 max-h-48 overflow-y-auto rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="px-2 py-1 text-left">Symbol</th>
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {emUniverse.topHoldings.slice(0, 10).map((row) => (
                  <tr key={row.symbol} className="border-t border-zinc-900">
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => selectChartSymbol(row.symbol)}
                        className="text-emerald-400/90 hover:text-emerald-300 hover:underline"
                      >
                        {row.symbol}
                      </button>
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1 text-zinc-400">
                      {row.name}
                    </td>
                    <td className="px-2 py-1 text-right text-zinc-400">
                      {(row.weight_bps / 100).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-zinc-900 px-2 py-1.5 text-[11px] text-zinc-600">
              Click a symbol to view its chart above.
            </p>
          </div>
        )}
      </SettingsCollapsible>
    </div>
  );
}
