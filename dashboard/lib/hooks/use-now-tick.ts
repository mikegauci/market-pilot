"use client";

import { useEffect, useState } from "react";

/**
 * Re-renders the caller on an interval so values derived from the clock (like heartbeat age)
 * keep updating even when the data feeding them has stopped changing.
 */
export function useNowTick(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
