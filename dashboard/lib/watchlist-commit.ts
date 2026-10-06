export type SearchCommitResult =
  | { kind: "noop" }
  | { kind: "bulk"; raw: string }
  | { kind: "add"; symbol: string }
  | { kind: "error"; message: string };

/** Decide what Enter should do in the watchlist search box. */
export function resolveSearchCommit(
  raw: string,
  filteredSymbols: string[],
  options?: { isValidSymbol?: (symbol: string) => boolean },
): SearchCommitResult {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "noop" };
  if (trimmed.includes(",")) return { kind: "bulk", raw: trimmed };

  const isValid = options?.isValidSymbol ?? (() => true);
  const upper = trimmed.toUpperCase();

  if (filteredSymbols.length === 1) {
    return { kind: "add", symbol: filteredSymbols[0]!.toUpperCase() };
  }

  if (filteredSymbols.length > 1) {
    const exactInResults = filteredSymbols.find((symbol) => symbol.toUpperCase() === upper);
    if (exactInResults) {
      return { kind: "add", symbol: exactInResults.toUpperCase() };
    }
    return {
      kind: "error",
      message: "Multiple matches — pick from the list or type the full ticker.",
    };
  }

  if (isValid(upper)) {
    return { kind: "add", symbol: upper };
  }

  return { kind: "error", message: "Enter a valid ticker symbol." };
}

/** Warn when count exceeds limit (pool rotation uses ~30). */
export function shouldWarnLargeWatchlist(count: number, threshold = 30): boolean {
  return count > threshold;
}
