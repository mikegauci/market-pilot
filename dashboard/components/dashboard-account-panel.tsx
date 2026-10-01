"use client";

import { LiveStatus } from "@/components/live-status";
import { NavEquity } from "@/components/nav-equity";
import { SidebarOpenPositions } from "@/components/sidebar-open-positions";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/** IBKR account, live equity, and system status — shared by right sidebar and mobile nav. */
export function DashboardAccountPanel({ className }: Props) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <NavEquity className="mb-0 px-0 py-0" />
      </div>
      <SidebarOpenPositions />
      <LiveStatus variant="sidebar" />
    </div>
  );
}
