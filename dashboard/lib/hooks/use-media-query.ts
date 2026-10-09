"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Tailwind `lg` breakpoint. */
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * Whether the media query matches. `null` during SSR and hydration, so callers can render
 * nothing instead of guessing a viewport and mounting the wrong tree.
 */
export function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): null {
  return null;
}
