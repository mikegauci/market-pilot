"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { Card, CardTitle } from "@/components/ui/card";
import { updateWatchlist } from "@/lib/actions";
import type { Settings } from "@/lib/types/database";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [symbols, setSymbols] = useState(() => resolveEffectiveWatchlist(settings));
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSymbols(resolveEffectiveWatchlist(settings));
  }, [settings]);

  function persistWatchlist(next: string[]) {
    setSaveError(null);
    const previous = symbols;
    setSymbols(next);
    startTransition(async () => {
      try {
        await updateWatchlist(next);
        router.refresh();
      } catch (error) {
        setSymbols(previous);
        setSaveError(error instanceof Error ? error.message : "Could not save watchlist");
      }
    });
  }

  function removeSymbol(symbol: string) {
    if (symbols.length <= 1) {
      setSaveError("Keep at least one symbol on the watchlist.");
      return;
    }
    persistWatchlist(symbols.filter((s) => s !== symbol));
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle>Your watchlist</CardTitle>
          <p className="text-xs leading-snug text-zinc-500">
            Symbols Jev monitors for entries. Add from the S&amp;P 500 or any ticker.
          </p>
        </div>
        <Link
          href="/settings#watchlist"
          className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300"
        >
          Settings
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {symbols.length ? (
          symbols.map((symbol) => (
            <span
              key={symbol}
              className="inline-flex items-center gap-1 rounded border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-200"
            >
              {symbol}
              <button
                type="button"
                disabled={pending}
                onClick={() => removeSymbol(symbol)}
                className="rounded px-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                aria-label={`Remove ${symbol} from watchlist`}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="text-xs text-zinc-500">No symbols configured</span>
        )}
      </div>

      <div className={`mt-3 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        <WatchlistPicker
          defaultValue={symbols}
          value={symbols}
          onChange={persistWatchlist}
          hideChipList
          compact
        />
      </div>

      {saveError ? <p className="mt-2 text-xs text-red-400">{saveError}</p> : null}
      {pending ? <p className="mt-2 text-xs text-zinc-500">Saving watchlist…</p> : null}
    </Card>
  );
}
