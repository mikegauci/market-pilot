import type { Settings } from "@/lib/types/database";

function benchmarkSymbol(settings: Settings): string {
  return (settings.benchmark_symbol || "").trim().toUpperCase();
}

export function stripBenchmark(settings: Settings, symbols: string[]): string[] {
  const benchmark = benchmarkSymbol(settings);
  return symbols.filter((symbol) => symbol.toUpperCase() !== benchmark);
}

function stripEntryBlocked(settings: Settings, symbols: string[]): string[] {
  const blocked = new Set(
    (settings.entry_blocked_symbols ?? []).map((symbol) => symbol.toUpperCase()),
  );
  if (blocked.size === 0) return symbols;
  return symbols.filter((symbol) => !blocked.has(symbol.toUpperCase()));
}

/** Symbols Jev evaluates for entries (benchmark and entry-blocked excluded). */
export function resolveEffectiveWatchlist(settings: Settings): string[] {
  const rotating = Boolean(settings.watchlist_rotation_enabled);
  const raw = rotating ? (settings.watchlist_active ?? []) : (settings.watchlist ?? []);
  return stripEntryBlocked(
    settings,
    stripBenchmark(settings, raw.map((symbol) => symbol.toUpperCase()).filter(Boolean)),
  );
}

export function formatPredictingWatchlistHeadline(symbolCount: number): string {
  if (symbolCount === 0) return "No symbols on watchlist";
  if (symbolCount === 1) return "1 symbol on watchlist";
  return `${symbolCount} symbols on watchlist`;
}
