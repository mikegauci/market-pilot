"use client";

import { useSyncExternalStore } from "react";

/** Tailwind `lg` breakpoint. */
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * Whether the media query matches. `null` during SSR and hydration, so callers can render
 * nothing instead of guessing a viewport and mounting the wrong tree.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}
