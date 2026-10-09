"use client";

import { useNow } from "@/lib/hooks/use-now";

/**
 * Re-renders the caller on an interval so values derived from the clock (like heartbeat age)
 * keep updating even when the data feeding them has stopped changing.
 */
export function useNowTick(intervalMs = 5000): number {
  return useNow(true, intervalMs);
}
