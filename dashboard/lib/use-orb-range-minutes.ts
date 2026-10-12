"use client";

import { useEffect, useState } from "react";
import { fetchSettings } from "@/lib/data-client";

const CACHE_MS = 60_000;
let cached: { at: number; minutes: number | null } | null = null;
let inflight: Promise<number | null> | null = null;

function loadOrbRangeMinutes(): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.minutes);
  inflight ??= fetchSettings()
    .then((settings) => {
      const minutes =
        settings?.entry_mode === "orb" ? (settings.orb_range_minutes ?? 5) : null;
      cached = { at: Date.now(), minutes };
      return minutes;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Opening range length in minutes when the bot is in opening range breakout mode, else null. */
export function useOrbRangeMinutes(): number | null {
  const [minutes, setMinutes] = useState<number | null>(cached?.minutes ?? null);
  useEffect(() => {
    let cancelled = false;
    void loadOrbRangeMinutes().then((value) => {
      if (!cancelled) setMinutes(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return minutes;
}
