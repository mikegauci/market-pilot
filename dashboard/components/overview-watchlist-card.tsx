"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { WatchlistCurationPanel } from "@/components/watchlist-curation-panel";
import type { Settings } from "@/lib/types/database";

type Props = {
  settings: Settings;
};

export function OverviewWatchlistCard({ settings }: Props) {
  return (
    <Card className="h-full">
      <CardTitle>Your watchlist</CardTitle>
      <div className="mt-3">
        <WatchlistCurationPanel key={settings.updated_at} settings={settings} compact />
      </div>
    </Card>
  );
}
