import type { WatchlistPin } from "@/lib/types/database";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidWatchlistSymbol(symbol: string): boolean {
  return SYMBOL_PATTERN.test(symbol);
}

export function parseWatchlistPins(raw: unknown): WatchlistPin[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const pins: WatchlistPin[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const symbol = normalizeSymbol(String(row.symbol ?? ""));
    if (!symbol || !isValidWatchlistSymbol(symbol)) continue;
    pins.push({
      symbol,
      locked: Boolean(row.locked),
      protect_demotion: Boolean(row.protect_demotion),
    });
  }
  return dedupePins(pins);
}

export function dedupePins(pins: WatchlistPin[]): WatchlistPin[] {
  const bySymbol = new Map<string, WatchlistPin>();
  for (const pin of pins) {
    bySymbol.set(pin.symbol, { ...pin, symbol: pin.symbol.toUpperCase() });
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function parseWatchlistDismissed(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const dismissed = new Set<string>();
  for (const item of raw) {
    const symbol = normalizeSymbol(String(item ?? ""));
    if (symbol && isValidWatchlistSymbol(symbol)) {
      dismissed.add(symbol);
    }
  }
  return [...dismissed].sort();
}

export function watchlistPinsToJson(pins: WatchlistPin[]): WatchlistPin[] {
  return dedupePins(pins).map((pin) => ({
    symbol: pin.symbol,
    locked: Boolean(pin.locked),
    protect_demotion: Boolean(pin.protect_demotion),
  }));
}

export type WatchlistCurationPayload = {
  watchlist_pins: WatchlistPin[];
  watchlist_dismissed: string[];
};

export function parseWatchlistCurationPayload(raw: unknown): WatchlistCurationPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid watchlist curation payload");
  }
  const body = raw as Record<string, unknown>;
  return {
    watchlist_pins: parseWatchlistPins(body.watchlist_pins),
    watchlist_dismissed: parseWatchlistDismissed(body.watchlist_dismissed),
  };
}
