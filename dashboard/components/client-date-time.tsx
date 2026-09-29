"use client";

import { useEffect, useState } from "react";
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
  const [label, setLabel] = useState(placeholder);

  useEffect(() => {
    setLabel(
      variant === "full" ? formatDateTimeFull(value) : formatDateTime(value),
    );
  }, [value, variant]);

  return (
    <span className={className} suppressHydrationWarning>
      {label}
    </span>
  );
}
