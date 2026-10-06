"use client";

import { useEffect, useState } from "react";

/** Milliseconds remaining until `expiresAtMs`, updating about once per second. */
export function useCountdownTo(expiresAtMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAtMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAtMs]);

  if (expiresAtMs == null) return null;
  return Math.max(0, expiresAtMs - now);
}
