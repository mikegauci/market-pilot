"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BotStatusProvider } from "@/components/bot-status-provider";
import {
  DashboardNavContent,
  getDashboardPageTitle,
} from "@/components/dashboard-nav";
import { IbkrAccountBadge } from "@/components/ibkr-account-badge";
import { Logo } from "@/components/logo";
import { OpenPositionsCountProvider } from "@/components/open-positions-count-provider";
import type { BotStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  children: ReactNode;
  botStatus: BotStatus;
};

export function DashboardShell({ children, botStatus }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageTitle = getDashboardPageTitle(pathname);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileOpen, closeMobile]);

  return (
    <BotStatusProvider initialStatus={botStatus}>
      <OpenPositionsCountProvider>
        <div className="flex min-h-screen">
          <aside className="hidden w-64 shrink-0 flex min-h-screen flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900/50 p-4 lg:flex">
            <DashboardNavContent />
          </aside>

          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden",
              mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden={!mobileOpen}
            onClick={closeMobile}
          />

          <aside
            id="mobile-nav-drawer"
            aria-hidden={!mobileOpen}
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-4 transition-transform duration-200 ease-out lg:hidden",
              mobileOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <DashboardNavContent onNavigate={closeMobile} />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur lg:hidden">
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav-drawer"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{pageTitle}</p>
                <IbkrAccountBadge compact />
              </div>
              <Logo size="sm" />
            </header>

            <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8">{children}</main>
          </div>
        </div>
      </OpenPositionsCountProvider>
    </BotStatusProvider>
  );
}
