"use client";

import { EmUniverseScanCountdown } from "@/components/em-universe-scan-countdown";
import { Card, CardTitle } from "@/components/ui/card";
import { WatchlistCurationPanel } from "@/components/watchlist-curation-panel";
import type { Settings } from "@/lib/types/database";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Your watchlist</CardTitle>
        <EmUniverseScanCountdown
          watchlist_dynamic_enabled={settings.watchlist_dynamic_enabled ?? true}
          watchlist_screener_ran_at={settings.watchlist_screener_ran_at}
          watchlist_refresh_minutes={settings.watchlist_refresh_minutes ?? 30}
          variant="overview"
        />
      </div>
      <div className="mt-3">
        <WatchlistCurationPanel key={settings.updated_at} settings={settings} compact />
      </div>
    </Card>
  );
}
