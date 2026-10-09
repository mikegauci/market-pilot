"use client";

import { DashboardAccountPanel } from "@/components/dashboard-account-panel";

export function DashboardRightSidebar() {
  return (
    <aside className="hidden w-72 shrink-0 min-h-screen flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-900/50 p-4 lg:flex">
      <DashboardAccountPanel viewport="desktop" />
    </aside>
  );
}
