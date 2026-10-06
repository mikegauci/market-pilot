"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { WatchlistMoveChip } from "@/components/watchlist-move-chip";
import { unblockSymbolFromEntries } from "@/lib/actions";
import { blockExpiryMinutes, formatCountdown } from "@/lib/entry-block-timing";
import { useCountdownTo } from "@/lib/hooks/use-countdown-ms";
import type { Settings } from "@/lib/types/database";

type Props = {
  settings: Settings;
  symbols: string[];
  changeBySymbol: Map<string, number>;
};

function BlockedSymbolRow({
  symbol,
  change5m,
  blockedAtIso,
  expiryMin,
  pending,
  onUnblock,
}: {
  symbol: string;
  change5m: number | undefined;
  blockedAtIso: string | undefined;
  expiryMin: number;
  pending: boolean;
  onUnblock: (symbol: string) => void;
}) {
  const expiresAtMs = useMemo(() => {
    if (!blockedAtIso) return null;
    const blockedMs = Date.parse(blockedAtIso);
    if (!Number.isFinite(blockedMs)) return null;
    return blockedMs + expiryMin * 60_000;
  }, [blockedAtIso, expiryMin]);
  const countdownMs = useCountdownTo(expiresAtMs);

  return (
    <li className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1">
        <WatchlistMoveChip symbol={symbol} change5m={change5m} />
        <button
          type="button"
          disabled={pending}
          onClick={() => onUnblock(symbol)}
          className="rounded px-1 text-[10px] uppercase tracking-wide text-emerald-400 hover:bg-zinc-800 disabled:opacity-40"
        >
          Unblock
        </button>
      </span>
      {countdownMs != null ? (
        <span className="pl-0.5 text-[10px] text-zinc-500">
          Back on active list in {formatCountdown(countdownMs)}
        </span>
      ) : null}
    </li>
  );
}

export function EntryBlockedSymbols({ settings, symbols, changeBySymbol }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const expiryMin = blockExpiryMinutes(settings);
  const blockedAt = settings.entry_blocked_at ?? {};

  if (!symbols.length) {
    return null;
  }

  function handleUnblock(symbol: string) {
    setError(null);
    startTransition(async () => {
      try {
        await unblockSymbolFromEntries(symbol);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not unblock symbol");
      }
    });
  }

  return (
    <div className="mt-3 border-t border-zinc-800/70 pt-3">
      <p className="text-xs font-medium text-zinc-400">Blocked from entries</p>
      <p className="mt-0.5 text-xs leading-snug text-zinc-500">
        No new trades for {expiryMin} minutes; Jev still updates the 5m move below.
        Symbols return to the active list automatically after that.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {symbols.map((symbol) => {
          const key = symbol.toUpperCase();
          return (
            <BlockedSymbolRow
              key={symbol}
              symbol={symbol}
              change5m={changeBySymbol.get(key)}
              blockedAtIso={blockedAt[key]}
              expiryMin={expiryMin}
              pending={pending}
              onUnblock={handleUnblock}
            />
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
