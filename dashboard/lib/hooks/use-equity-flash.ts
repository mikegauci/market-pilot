"use client";

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 700;

export type EquityFlash = "up" | "down" | null;

/** Brief up/down flash when equity changes. Returns CSS class helpers. */
export function useEquityFlash(equity: number | null | undefined): {
  flash: EquityFlash;
  flashKey: number;
  flashClassName: string | undefined;
} {
  const [flash, setFlash] = useState<EquityFlash>(null);
  const [flashKey, setFlashKey] = useState(0);
  const prevEquityRef = useRef<number | null>(null);

  useEffect(() => {
    if (equity == null) return;

    const prev = prevEquityRef.current;
    prevEquityRef.current = equity;

    if (prev == null || prev === equity) return;

    setFlash(equity > prev ? "up" : "down");
    setFlashKey((k) => k + 1);
    const id = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [equity]);

  return {
    flash,
    flashKey,
    flashClassName:
      flash === "up"
        ? "nav-equity-flash-up"
        : flash === "down"
          ? "nav-equity-flash-down"
          : undefined,
  };
}
