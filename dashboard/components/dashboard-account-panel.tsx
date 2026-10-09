"use client";

import { LiveStatus } from "@/components/live-status";
import { TraderControlButtons } from "@/components/trader-control-buttons";
import { NavEquity } from "@/components/nav-equity";
import { SidebarOpenPositions } from "@/components/sidebar-open-positions";
import { SidebarRecentBuyPredictions } from "@/components/sidebar-recent-buy-predictions";
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Where this copy lives. Only the copy for the current viewport mounts, so its polling runs once. */
  viewport: "desktop" | "mobile";
};

/** IBKR account, live equity, and system status — shared by right sidebar and mobile nav. */
export function DashboardAccountPanel({ className, viewport }: Props) {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  if (isDesktop === null || isDesktop !== (viewport === "desktop")) return null;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <NavEquity className="mb-0 px-0 py-0" />
      </div>
      <LiveStatus variant="sidebar" />
      <TraderControlButtons />
      <SidebarRecentBuyPredictions />
      <SidebarOpenPositions />
    </div>
  );
}
