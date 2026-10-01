"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateWatchlistCuration } from "@/lib/actions";
import {
  buildWatchlistDisplayRows,
  resolveEffectiveWatchlistFromCuration,
} from "@/lib/effective-watchlist";
import type { Settings, WatchlistPin } from "@/lib/types/database";
import {
  dedupePins,
  isValidWatchlistSymbol,
  isWatchlistCurationDirty,
  normalizeSymbol,
  parseWatchlistDismissed,
  parseWatchlistPins,
  watchlistPinsToJson,
} from "@/lib/watchlist-curation";
import { cn } from "@/lib/utils";

type Props = {
  settings: Settings;
  /** Compact layout for Overview card */
  compact?: boolean;
};

function pinForSymbol(pins: WatchlistPin[], symbol: string): WatchlistPin | undefined {
  return pins.find((pin) => pin.symbol === symbol);
}

export function WatchlistCurationPanel({ settings, compact = false }: Props) {
  const router = useRouter();
  const [explicitPins, setExplicitPins] = useState<WatchlistPin[]>(() =>
    parseWatchlistPins(settings.watchlist_pins),
  );
  const [dismissed, setDismissed] = useState<string[]>(() =>
    parseWatchlistDismissed(settings.watchlist_dismissed),
  );
  const [addSymbol, setAddSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const savedCuration = useMemo(
    () => ({
      watchlist_pins: parseWatchlistPins(settings.watchlist_pins),
      watchlist_dismissed: parseWatchlistDismissed(settings.watchlist_dismissed),
    }),
    [settings.watchlist_pins, settings.watchlist_dismissed, settings.updated_at],
  );

  const isDirty = useMemo(
    () => isWatchlistCurationDirty(explicitPins, dismissed, savedCuration),
    [explicitPins, dismissed, savedCuration],
  );

  const displayRows = useMemo(
    () => buildWatchlistDisplayRows(settings, explicitPins, dismissed),
    [settings, explicitPins, dismissed],
  );

  const effectivePreview = useMemo(() => {
    const symbols = resolveEffectiveWatchlistFromCuration(
      settings,
      watchlistPinsToJson(explicitPins),
      dismissed,
    );
    return [...symbols].sort();
  }, [settings, explicitPins, dismissed]);

  function upsertExplicitPin(symbol: string, patch: Partial<WatchlistPin>) {
    const key = normalizeSymbol(symbol);
    setExplicitPins((current) => {
      const existing = pinForSymbol(current, key);
      const next: WatchlistPin = {
        symbol: key,
        locked: patch.locked ?? existing?.locked ?? false,
        protect_demotion: patch.protect_demotion ?? existing?.protect_demotion ?? false,
      };
      const without = current.filter((pin) => pin.symbol !== key);
      return dedupePins([...without, next]);
    });
  }

  function handleAdd() {
    setError(null);
    const symbol = normalizeSymbol(addSymbol);
    if (!symbol) return;
    if (!isValidWatchlistSymbol(symbol)) {
      setError("Enter a valid US ticker (e.g. TSM).");
      return;
    }
    setDismissed((current) => current.filter((item) => item !== symbol));
    upsertExplicitPin(symbol, { locked: true, protect_demotion: true });
    setAddSymbol("");
  }

  function handleRemove(symbol: string) {
    const key = normalizeSymbol(symbol);
    setExplicitPins((current) => current.filter((pin) => pin.symbol !== key));
    setDismissed((current) => [...new Set([...current, key])].sort());
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateWatchlistCuration({
          watchlist_pins: watchlistPinsToJson(explicitPins),
          watchlist_dismissed: dismissed,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className={cn("space-y-3", compact && "text-sm")}>
      <p className="text-xs text-zinc-500">
        Add or remove symbols, lock names so EM scans cannot drop them (extra slots beyond max
        dynamic), and choose demotion protection per symbol. Only rows you change here are saved —
        scan picks rotate unless locked. Locked names auto-unpin if Jev BUY falls below watchlist
        min BUY after a scan.
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          value={addSymbol}
          onChange={(e) => setAddSymbol(e.target.value.toUpperCase())}
          placeholder="Add symbol"
          className="max-w-[8rem] font-mono text-xs"
          aria-label="Add watchlist symbol"
        />
        <Button
          type="button"
          className="bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
          onClick={handleAdd}
        >
          Add
        </Button>
        {isDirty ? (
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            disabled={pending}
            onClick={handleSave}
          >
            {pending ? "Saving…" : "Save watchlist"}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <div
        className={cn(
          "overflow-y-auto overflow-x-auto rounded border border-zinc-800",
          compact ? "max-h-52" : "max-h-72",
        )}
      >
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-950 text-zinc-500">
            <tr>
              <th className="px-2 py-1.5 text-left">Symbol</th>
              <th className="px-2 py-1.5 text-left">Lock</th>
              <th className="px-2 py-1.5 text-left">Demotion protect</th>
              <th className="px-2 py-1.5 text-right">Remove</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-zinc-500">
                  No symbols — add one or wait for a dynamic scan.
                </td>
              </tr>
            ) : (
              displayRows.map((pin) => (
                <tr key={pin.symbol} className="border-t border-zinc-900">
                  <td className="px-2 py-1.5 font-mono text-zinc-200">{pin.symbol}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      title={pin.locked ? "Locked — scan cannot drop" : "Unlocked — scan may rotate out"}
                      onClick={() => upsertExplicitPin(pin.symbol, { locked: !pin.locked })}
                      className="inline-flex items-center gap-1 text-zinc-300 hover:text-emerald-300"
                    >
                      {pin.locked ? (
                        <Lock className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <LockOpen className="h-3.5 w-3.5" />
                      )}
                      <span className="sr-only">{pin.locked ? "Locked" : "Unlocked"}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-zinc-400">
                      <input
                        type="checkbox"
                        checked={pin.protect_demotion}
                        onChange={(e) =>
                          upsertExplicitPin(pin.symbol, { protect_demotion: e.target.checked })
                        }
                        className="rounded border-zinc-700"
                      />
                      <span className="hidden sm:inline">Protect</span>
                    </label>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      title="Remove and block from next scan picks"
                      onClick={() => handleRemove(pin.symbol)}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="inline h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-zinc-800/80 bg-zinc-950/40 px-2 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Bot will watch
        </p>
        <p className="mt-1 font-mono text-xs text-zinc-200">
          {effectivePreview.length ? effectivePreview.join(", ") : "—"}
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">Open positions are added at runtime.</p>
      </div>
    </div>
  );
}
