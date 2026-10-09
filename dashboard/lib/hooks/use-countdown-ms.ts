"use client";

import { useNow } from "@/lib/hooks/use-now";

/** Milliseconds remaining until `expiresAtMs`, updating about once per second. */
export function useCountdownTo(expiresAtMs: number | null): number | null {
  const now = useNow(expiresAtMs != null, 1000);
  if (expiresAtMs == null) return null;
  return Math.max(0, expiresAtMs - now);
}
