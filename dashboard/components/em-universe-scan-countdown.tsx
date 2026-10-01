"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatEmUniverseScanCountdown,
  resolveEmUniverseScanSchedule,
  type EmUniverseScanCountdownVariant,
} from "@/lib/effective-watchlist";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { cn } from "@/lib/utils";

type Props = {
  watchlist_dynamic_enabled: boolean;
  watchlist_screener_ran_at: string | null;
  watchlist_refresh_minutes: number;
  variant?: EmUniverseScanCountdownVariant;
  className?: string;
};

export function EmUniverseScanCountdown({
  watchlist_dynamic_enabled,
  watchlist_screener_ran_at,
  watchlist_refresh_minutes,
  variant = "overview",
  className,
}: Props) {
  const isClient = useIsClient();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const scheduleInput = useMemo(
    () => ({
      watchlist_dynamic_enabled,
      watchlist_screener_ran_at,
      watchlist_refresh_minutes,
    }),
    [watchlist_dynamic_enabled, watchlist_screener_ran_at, watchlist_refresh_minutes],
  );

  const schedule = useMemo(
    () => resolveEmUniverseScanSchedule(scheduleInput, now),
    [scheduleInput, now],
  );

  if (!schedule.visible) {
    return null;
  }

  const label = isClient
    ? formatEmUniverseScanCountdown(schedule, now, variant)
    : variant === "settings"
      ? "Next scan —"
      : "Next full EM scan —";

  return (
    <span
      className={cn(
        variant === "overview" ? "text-xs text-zinc-500" : "text-xs text-zinc-500",
        className,
      )}
      suppressHydrationWarning
    >
      {label}
    </span>
  );
}
