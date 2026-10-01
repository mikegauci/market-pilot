"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { WatchlistCurationPanel } from "@/components/watchlist-curation-panel";
import type { Settings } from "@/lib/types/database";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  if (!settings.watchlist_dynamic_enabled) {
    return null;
  }

  return (
    <Card className="col-span-1 sm:col-span-2 xl:col-span-3">
      <CardTitle>Your watchlist</CardTitle>
      <div className="mt-3">
        <WatchlistCurationPanel key={settings.updated_at} settings={settings} compact />
      </div>
    </Card>
  );
}
