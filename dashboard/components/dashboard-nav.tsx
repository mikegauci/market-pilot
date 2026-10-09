"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Layers,
  LineChart,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Newspaper,
  Settings,
  TrendingUp,
} from "lucide-react";
import { DashboardAccountPanel } from "@/components/dashboard-account-panel";
import { Logo } from "@/components/logo";
import { useOpenPositionsCount } from "@/components/open-positions-count-provider";
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
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

function OpenPositionsBadge({ collapsed }: { collapsed?: boolean }) {
  const count = useOpenPositionsCount();

  if (count === 0) return null;

  if (collapsed) {
    return <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-400" />;
  }

  return (
    <span className="ml-auto rounded-full bg-blue-900/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-300">
      {count}
    </span>
  );
}

export function DashboardNavContent({
  onNavigate,
  logoSize = "md",
  collapsed = false,
  onToggleCollapsed,
}: DashboardNavContentProps) {
  const pathname = usePathname();
  const router = useRouter();

  const primaryLinks = dashboardNavLinks.filter(({ href }) => href !== "/settings");
  const settingsLink = dashboardNavLinks.find(({ href }) => href === "/settings")!;

  function navLinkClass(href: string) {
    return cn(
      "relative flex min-h-11 items-center gap-2 rounded-md py-2.5 text-sm transition",
      collapsed ? "justify-center px-0" : "px-3",
      pathname === href
        ? "bg-emerald-900/40 text-emerald-300"
        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-6">
        <Logo
          size={logoSize}
          showText={!collapsed}
          className={collapsed ? "justify-center" : undefined}
        />
      </div>

      <nav className="flex flex-col gap-1">
        {primaryLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={navLinkClass(href)}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {collapsed ? (
              href === "/" ? <OpenPositionsBadge collapsed /> : null
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {label}
                {href === "/" ? <OpenPositionsBadge /> : null}
              </span>
            )}
          </Link>
        ))}

        <Link
          href={settingsLink.href}
          onClick={onNavigate}
          className={navLinkClass(settingsLink.href)}
          title={collapsed ? settingsLink.label : undefined}
          aria-label={collapsed ? settingsLink.label : undefined}
        >
          <settingsLink.icon className="h-4 w-4 shrink-0" />
          {collapsed ? null : settingsLink.label}
        </Link>

      </nav>

      {onNavigate ? (
        <div className="mt-4">
          <DashboardAccountPanel viewport="mobile" />
        </div>
      ) : null}

      {onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mt-auto flex min-h-11 items-center gap-2 rounded-md py-2.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          )}
          {collapsed ? null : "Collapse"}
        </button>
      ) : null}

      <button
        type="button"
        onClick={async () => {
          onNavigate?.();
          await signOut();
          router.push("/login");
          router.refresh();
        }}
        title={collapsed ? "Sign out" : undefined}
        aria-label={collapsed ? "Sign out" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-md py-2.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
          onToggleCollapsed ? "" : "mt-auto pt-6",
          collapsed ? "justify-center px-0" : "px-3",
        )}
      >
        <LogOut className="h-4 w-4 shrink-0" />
        {collapsed ? null : "Sign out"}
      </button>
    </div>
  );
}
