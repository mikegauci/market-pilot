"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { WatchlistPicker } from "@/components/watchlist-picker";
import { WatchlistMoveChip } from "@/components/watchlist-move-chip";
import { Card, CardTitle } from "@/components/ui/card";
import { EntryBlockedSymbols } from "@/components/entry-blocked-symbols";
import { useReadOnly } from "@/components/read-only-provider";
import { blockSymbolFromEntries, updateWatchlist } from "@/lib/actions";
import { mergeEntryBlockedSymbols } from "@/lib/entry-blocked-symbols";
import { useLatestPredictions } from "@/lib/latest-predictions-context";
import { watchlistMovesFromPredictions } from "@/lib/market-condition";
import type { Settings } from "@/lib/types/database";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { formatCountdown } from "@/lib/entry-block-timing";
import { useCountdownTo } from "@/lib/hooks/use-countdown-ms";

type Props = {
  settings: Settings;
  /** Symbols with an open long — block is disabled until the position closes. */
  openSymbols?: string[];
};

export function OverviewWatchlistCard({ settings, openSymbols = [] }: Props) {
  const readOnly = useReadOnly();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const serverSymbols = useMemo(
    () => resolveEffectiveWatchlist(settings),
    [settings],
  );
  const [optimisticSymbols, setOptimisticSymbols] = useState<string[] | null>(null);
  const symbols = optimisticSymbols ?? serverSymbols;
  const [optimisticBlocked, setOptimisticBlocked] = useState<string[] | null>(null);
  const serverBlocked = useMemo(
    () => settings.entry_blocked_symbols ?? [],
    [settings.entry_blocked_symbols],
  );
  const blockedSymbols = optimisticBlocked ?? serverBlocked;
  const [saveError, setSaveError] = useState<string | null>(null);

  const openSymbolSet = useMemo(
    () => new Set(openSymbols.map((symbol) => symbol.toUpperCase())),
    [openSymbols],
  );

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

  function blockSymbol(symbol: string) {
    const key = symbol.toUpperCase();
    if (openSymbolSet.has(key)) {
      setSaveError(`Close the open ${symbol} position before blocking entries.`);
      return;
    }
    setSaveError(null);
    const previousSymbols = symbols;
    const previousBlocked = blockedSymbols;
    setOptimisticSymbols(symbols.filter((s) => s.toUpperCase() !== key));
    setOptimisticBlocked(mergeEntryBlockedSymbols(blockedSymbols, [symbol]));
    startTransition(async () => {
      try {
        await blockSymbolFromEntries(symbol);
        setOptimisticSymbols(null);
        setOptimisticBlocked(null);
        router.refresh();
      } catch (error) {
        setOptimisticSymbols(previousSymbols);
        setOptimisticBlocked(previousBlocked);
        setSaveError(error instanceof Error ? error.message : "Could not block symbol");
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

  const moveScope = useMemo(
    () => [...new Set([...symbols, ...blockedSymbols].map((s) => s.toUpperCase()))],
    [symbols, blockedSymbols],
  );

  const changeBySymbol = useMemo(() => {
    const moves = watchlistMovesFromPredictions(predictions, moveScope, benchmark);
    return new Map(moves.map((move) => [move.symbol.toUpperCase(), move.change5m]));
  }, [predictions, moveScope, benchmark]);

  const hasMoveData = changeBySymbol.size > 0;

  const nextRotationAtMs = useMemo(() => {
    const last = settings.watchlist_last_rotation_at;
    if (!last) return null;
    const lastMs = Date.parse(last);
    if (!Number.isFinite(lastMs)) return null;
    return lastMs + rotationIntervalMin * 60_000;
  }, [settings.watchlist_last_rotation_at, rotationIntervalMin]);
  const rotationCountdownMs = useCountdownTo(rotating ? nextRotationAtMs : null);

  function blockButton(symbol: string) {
    if (readOnly) return null;
    const key = symbol.toUpperCase();
    const positionOpen = openSymbolSet.has(key);
    return (
      <button
        type="button"
        disabled={pending || positionOpen}
        onClick={() => blockSymbol(symbol)}
        className="rounded px-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-amber-200 disabled:opacity-40"
        aria-label={
          positionOpen
            ? `${symbol} has an open position — close it before blocking`
            : `Block ${symbol} from new entries`
        }
        title={
          positionOpen
            ? "Close the open position before blocking"
            : "Block from entries"
        }
      >
        ⊘
      </button>
    );
  }

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
          {rotating ? (
            <p className="text-xs text-zinc-400">
              {rotationCountdownMs != null
                ? `Next list scan in ${formatCountdown(rotationCountdownMs)}`
                : `List scan every ${rotationIntervalMin} minutes (first run pending)`}
            </p>
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
                rotating ? (
                  blockButton(symbol)
                ) : readOnly ? null : (
                  <span className="inline-flex items-center">
                    {blockButton(symbol)}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => removeSymbol(symbol)}
                      className="rounded px-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                      aria-label={`Remove ${symbol} from watchlist (can re-add later)`}
                      title="Remove only — not blocked from re-entry"
                    >
                      ×
                    </button>
                  </span>
                )
              }
            />
          ))
        ) : (
          <span className="text-xs text-zinc-500">
            {rotating ? "Active list is empty — the bot will refill on the next rotation." : "No symbols configured"}
          </span>
        )}
      </div>

      <EntryBlockedSymbols
        settings={settings}
        symbols={blockedSymbols}
        changeBySymbol={changeBySymbol}
      />

      {!readOnly && !rotating ? (
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
      ) : null}

      {saveError ? <p className="mt-2 text-xs text-red-400">{saveError}</p> : null}
      {pending ? <p className="mt-2 text-xs text-zinc-500">Saving watchlist…</p> : null}
    </Card>
  );
}
