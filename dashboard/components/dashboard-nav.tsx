"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Layers,
  LineChart,
  LogOut,
  Newspaper,
  Settings,
  TrendingUp,
} from "lucide-react";
import { LiveStatus } from "@/components/live-status";
import { Logo } from "@/components/logo";
import { NavEquity } from "@/components/nav-equity";
import { useOpenPositionsCount } from "@/components/open-positions-count-provider";
import { TradingControls } from "@/components/trading-controls";
import { signOut } from "@/lib/actions";
import { cn } from "@/lib/utils";

export const dashboardNavLinks = [
  { href: "/", label: "Overview", icon: LineChart },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/predictions", label: "Predictions", icon: Activity },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/trades", label: "Trades", icon: TrendingUp },
  { href: "/strategy", label: "Strategy", icon: Layers },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function getDashboardPageTitle(pathname: string): string {
  const match = dashboardNavLinks.find(({ href }) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href),
  );
  return match?.label ?? "Market Pilot";
}

type DashboardNavContentProps = {
  onNavigate?: () => void;
  logoSize?: "sm" | "md";
};

function OpenPositionsBadge() {
  const count = useOpenPositionsCount();

  if (count === 0) return null;

  return (
    <span className="ml-auto rounded-full bg-blue-900/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-300">
      {count}
    </span>
  );
}

export function DashboardNavContent({
  onNavigate,
  logoSize = "md",
}: DashboardNavContentProps) {
  const pathname = usePathname();
  const router = useRouter();

  const primaryLinks = dashboardNavLinks.filter(({ href }) => href !== "/settings");
  const settingsLink = dashboardNavLinks.find(({ href }) => href === "/settings")!;

  function navLinkClass(href: string) {
    return cn(
      "flex min-h-11 items-center gap-2 rounded-md px-3 py-2.5 text-sm transition",
      pathname === href
        ? "bg-emerald-900/40 text-emerald-300"
        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-6">
        <Logo size={logoSize} />
      </div>

      <nav className="flex flex-col gap-1">
        <NavEquity />

        {primaryLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={navLinkClass(href)}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {label}
              {href === "/" ? <OpenPositionsBadge /> : null}
            </span>
          </Link>
        ))}

        <Link
          href={settingsLink.href}
          onClick={onNavigate}
          className={navLinkClass(settingsLink.href)}
        >
          <settingsLink.icon className="h-4 w-4 shrink-0" />
          {settingsLink.label}
        </Link>

        <div className="mt-3 space-y-3">
          <LiveStatus variant="sidebar" />
          <TradingControls variant="sidebar" />
        </div>
      </nav>

      <button
        type="button"
        onClick={async () => {
          onNavigate?.();
          await signOut();
          router.push("/login");
          router.refresh();
        }}
        className="mt-auto flex min-h-11 items-center gap-2 rounded-md px-3 py-2.5 pt-6 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>
    </div>
  );
}
