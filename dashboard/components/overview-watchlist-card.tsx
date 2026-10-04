"use client";

import Link from "next/link";
import { EmUniverseScanCountdown } from "@/components/em-universe-scan-countdown";
import { Card, CardTitle } from "@/components/ui/card";
import { WatchlistCurationPanel } from "@/components/watchlist-curation-panel";
import type { Settings } from "@/lib/types/database";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle>Your watchlist</CardTitle>
          <p className="text-xs leading-snug text-zinc-500">
            Lock symbols to keep them through scans. Save applies lock, protect, and remove changes;
            unlocked scan picks can rotate.
          </p>
        </div>
        <Link
          href="/settings#watchlist"
          className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300"
        >
          Settings
        </Link>
      </div>
      <EmUniverseScanCountdown
        className="mt-1 block"
        watchlist_dynamic_enabled={settings.watchlist_dynamic_enabled ?? true}
        watchlist_screener_ran_at={settings.watchlist_screener_ran_at}
        watchlist_refresh_minutes={settings.watchlist_refresh_minutes ?? 30}
        variant="overview"
      />
      <div className="mt-2">
        <WatchlistCurationPanel key={settings.updated_at} settings={settings} compact />
      </div>
    </Card>
  );
}
