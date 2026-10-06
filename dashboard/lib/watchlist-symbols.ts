/** US equity ticker pattern (matches watchlist picker validation). */
export const WATCHLIST_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

/** Uppercase, trim, dedupe — canonical watchlist symbol list. */
export function normalizeWatchlistSymbols(symbols: Iterable<string>): string[] {
  return [
    ...new Set(
      [...symbols].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ),
  ];
}

export function parseWatchlistCsv(raw: string): string[] {
  return normalizeWatchlistSymbols(raw.split(","));
}

export function isValidWatchlistSymbol(symbol: string): boolean {
  return WATCHLIST_SYMBOL_PATTERN.test(symbol);
}

export function mergeWatchlistSymbolLists(
  ...lists: (string[] | undefined)[]
): string[] {
  return normalizeWatchlistSymbols(lists.flatMap((list) => list ?? []));
}

/** Comma-separated value for hidden form fields. */
export function watchlistSymbolsHiddenValue(symbols: string[]): string {
  return symbols.join(", ");
}
