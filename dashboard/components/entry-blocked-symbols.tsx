"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unblockSymbolFromEntries } from "@/lib/actions";

type Props = {
  symbols: string[];
};

export function EntryBlockedSymbols({ symbols }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
        The bot won&apos;t scan or open new trades in these names until you unblock them.
        Unblocking does not add them back to the active list right away.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {symbols.map((symbol) => (
          <li key={symbol}>
            <span className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900/80 px-2 py-1 font-mono text-xs text-zinc-300">
              {symbol}
              <button
                type="button"
                disabled={pending}
                onClick={() => handleUnblock(symbol)}
                className="rounded px-1 text-[10px] uppercase tracking-wide text-emerald-400 hover:bg-zinc-800 disabled:opacity-40"
              >
                Unblock
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
