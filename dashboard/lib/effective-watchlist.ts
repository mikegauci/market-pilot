import type { Settings } from "@/lib/types/database";

function benchmarkSymbol(settings: Settings): string {
  return (settings.benchmark_symbol || "EEM").toUpperCase();
}

export function stripBenchmark(settings: Settings, symbols: string[]): string[] {
  const benchmark = benchmarkSymbol(settings);
  return symbols.filter((symbol) => symbol.toUpperCase() !== benchmark);
}

/** Symbols Jev evaluates for entries (benchmark excluded). */
export function resolveEffectiveWatchlist(settings: Settings): string[] {
  const raw = settings.watchlist ?? [];
  return stripBenchmark(settings, raw.map((symbol) => symbol.toUpperCase()).filter(Boolean));
}

export function formatPredictingWatchlistHeadline(symbolCount: number): string {
  if (symbolCount === 0) return "No symbols on watchlist";
  if (symbolCount === 1) return "1 symbol on watchlist";
  return `${symbolCount} symbols on watchlist`;
}
