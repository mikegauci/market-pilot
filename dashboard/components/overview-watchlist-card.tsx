"use client";

import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import type { Settings } from "@/lib/types/database";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  const symbols = resolveEffectiveWatchlist(settings);

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle>Your watchlist</CardTitle>
          <p className="text-xs leading-snug text-zinc-500">
            Symbols Jev monitors for entries. Edit the list in Settings.
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
              className="rounded border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-200"
            >
              {symbol}
            </span>
          ))
        ) : (
          <span className="text-xs text-zinc-500">No symbols configured</span>
        )}
      </div>
    </Card>
  );
}
