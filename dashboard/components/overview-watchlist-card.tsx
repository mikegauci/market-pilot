"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { WatchlistMoveChip } from "@/components/watchlist-move-chip";
import { Card, CardTitle } from "@/components/ui/card";
import { updateWatchlist } from "@/lib/actions";
import { useLatestPredictions } from "@/lib/latest-predictions-context";
import { watchlistMovesFromPredictions } from "@/lib/market-condition";
import type { Settings } from "@/lib/types/database";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const serverSymbols = useMemo(
    () => resolveEffectiveWatchlist(settings),
    [settings],
  );
  const [optimisticSymbols, setOptimisticSymbols] = useState<string[] | null>(null);
  const symbols = optimisticSymbols ?? serverSymbols;
  const [saveError, setSaveError] = useState<string | null>(null);

  function persistWatchlist(next: string[]) {
    setSaveError(null);
    const previous = symbols;
    setOptimisticSymbols(next);
    startTransition(async () => {
      try {
        await updateWatchlist(next);
        setOptimisticSymbols(null);
        router.refresh();
      } catch (error) {
        setOptimisticSymbols(previous);
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

  const rotating = Boolean(settings.watchlist_rotation_enabled);
  const rotationIntervalMin = settings.watchlist_rotation_interval_minutes ?? 15;
  const maxSwapsPerRotation = settings.watchlist_max_swaps_per_rotation ?? 2;
  const predictions = useLatestPredictions();
  const benchmark = settings.benchmark_symbol ?? "";

  const changeBySymbol = useMemo(() => {
    const moves = watchlistMovesFromPredictions(predictions, symbols, benchmark);
    return new Map(moves.map((move) => [move.symbol.toUpperCase(), move.change5m]));
  }, [predictions, symbols, benchmark]);

  const hasMoveData = changeBySymbol.size > 0;

  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle>{rotating ? "Active list" : "Your watchlist"}</CardTitle>
          <p className="text-xs leading-snug text-zinc-500">
            {rotating
              ? `Jev checks these names. The bot swaps up to ${maxSwapsPerRotation} every ${rotationIntervalMin} minutes.`
              : "Symbols Jev monitors for entries. Add from the S&P 500 or any ticker."}
          </p>
          {rotating && settings.watchlist_last_rotation_note ? (
            <p className="text-xs text-zinc-400">Last change: {settings.watchlist_last_rotation_note}</p>
          ) : null}
          {hasMoveData ? (
            <p className="text-xs text-zinc-500">
              Green / amber / red = 5m move from the last bot scan.
            </p>
          ) : null}
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
            <WatchlistMoveChip
              key={symbol}
              symbol={symbol}
              change5m={changeBySymbol.get(symbol.toUpperCase())}
              trailing={
                rotating ? null : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeSymbol(symbol)}
                    className="rounded px-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                    aria-label={`Remove ${symbol} from watchlist`}
                  >
                    ×
                  </button>
                )
              }
            />
          ))
        ) : (
          <span className="text-xs text-zinc-500">No symbols configured</span>
        )}
      </div>

      {rotating ? null : (
      <div
        className={`mt-4 border-t border-zinc-800/70 pt-4 ${pending ? "pointer-events-none opacity-60" : ""}`}
      >
        <WatchlistPicker
          defaultValue={symbols}
          value={symbols}
          onChange={persistWatchlist}
          hideChipList
          compact
        />
      </div>
      )}

      {saveError ? <p className="mt-2 text-xs text-red-400">{saveError}</p> : null}
      {pending ? <p className="mt-2 text-xs text-zinc-500">Saving watchlist…</p> : null}
    </Card>
  );
}
