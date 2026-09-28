"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, LineChart, LogOut, Settings, TrendingUp } from "lucide-react";
import { Logo } from "@/components/logo";
import { MarketClock } from "@/components/market-clock";
import { signOut } from "@/lib/actions";
import { cn } from "@/lib/utils";

export const dashboardNavLinks = [
  { href: "/", label: "Overview", icon: LineChart },
  { href: "/predictions", label: "Predictions", icon: Activity },
  { href: "/trades", label: "Trades", icon: TrendingUp },
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

export function DashboardNavContent({
  onNavigate,
  logoSize = "md",
}: DashboardNavContentProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <>
      <div className="mb-8">
        <Logo size={logoSize} />
        <p className="mt-2 text-xs text-zinc-500">Paper trading</p>
        <MarketClock />
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {dashboardNavLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-md px-3 py-2.5 text-sm transition",
              pathname === href
                ? "bg-emerald-900/40 text-emerald-300"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={async () => {
          onNavigate?.();
          await signOut();
          router.push("/login");
          router.refresh();
        }}
        className="mt-4 flex min-h-11 items-center gap-2 rounded-md px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>
    </>
  );
}

export function DashboardNav() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/50 p-4">
      <DashboardNavContent />
    </aside>
  );
}
