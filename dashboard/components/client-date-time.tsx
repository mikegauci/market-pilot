"use client";

import { useIsClient } from "@/lib/hooks/use-is-client";
import { formatDateTime, formatDateTimeFull } from "@/lib/utils";

/** Local timestamps after mount — avoids SSR/client timezone hydration mismatches. */
export function ClientDateTime({
  value,
  variant = "full",
  placeholder = "—",
  className,
}: {
  value: string | null | undefined;
  variant?: "full" | "short";
  placeholder?: string;
  className?: string;
}) {
  const isClient = useIsClient();
  const label =
    isClient && value
      ? variant === "full"
        ? formatDateTimeFull(value)
        : formatDateTime(value)
      : placeholder;

  return (
    <span className={className} suppressHydrationWarning>
      {label}
    </span>
  );
}
