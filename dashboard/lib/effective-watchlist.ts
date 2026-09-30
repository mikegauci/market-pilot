import type { JevRanking, Settings } from "@/lib/types/database";

function resolveWatchlistCore(settings: Settings): string[] {
  const core = settings.watchlist_core?.length
    ? settings.watchlist_core
    : settings.watchlist;
  return core.map((symbol) => symbol.toUpperCase()).filter(Boolean);
}

function effectiveBenchmark(settings: Settings): string {
  return (settings.benchmark_symbol || "EEM").toUpperCase();
}

function untradeableBenchmarks(settings: Settings): Set<string> {
  const symbols = new Set<string>([effectiveBenchmark(settings)]);
  const configured = (settings.benchmark_symbol || "").toUpperCase();
  if (configured) symbols.add(configured);
  return symbols;
}

function filterStaleCoreFromSaved(settings: Settings, saved: string[]): string[] {
  const core = new Set(resolveWatchlistCore(settings));
  const blocked = untradeableBenchmarks(settings);
  const dynamicSize = Math.max(0, settings.watchlist_dynamic_size ?? 5);
  const minBuy = settings.watchlist_min_buy ?? 0.6;
  const rankedTop = new Set<string>();
  for (const row of settings.watchlist_jev_rankings ?? []) {
    const symbol = row.symbol.toUpperCase();
    if (blocked.has(symbol)) continue;
    if (row.buy < minBuy) continue;
    rankedTop.add(symbol);
    if (rankedTop.size >= dynamicSize) break;
  }
  const filtered: string[] = [];
  for (const raw of saved) {
    const symbol = raw.toUpperCase();
    if (!symbol) continue;
    // Benchmark is for headwind/context only — never keep it as a tradable name.
    if (blocked.has(symbol)) {
      continue;
    }
    if (core.has(symbol) && !rankedTop.has(symbol)) {
      continue;
    }
    filtered.push(symbol);
  }
  return filtered;
}

function stripBenchmark(settings: Settings, symbols: string[]): string[] {
  const blocked = untradeableBenchmarks(settings);
  return symbols.filter((symbol) => !blocked.has(symbol.toUpperCase()));
}

export type WatchlistScanStatus =
  | { mode: "always_on" }
  | { mode: "waiting_first_scan" }
  | { mode: "last_scan"; ranAt: string };

/** Human-readable status for the effective watchlist section. */
export function resolveWatchlistScanStatus(settings: Settings): WatchlistScanStatus {
  if (!settings.watchlist_dynamic_enabled) {
    return { mode: "always_on" };
  }
  if (!settings.watchlist_screener_ran_at) {
    return { mode: "waiting_first_scan" };
  }
  return { mode: "last_scan", ranAt: settings.watchlist_screener_ran_at };
}

export function formatWatchlistScanStatus(status: WatchlistScanStatus): string {
  switch (status.mode) {
    case "always_on":
      return "Using always-on symbols only (dynamic mode off).";
    case "waiting_first_scan":
      return "Waiting for first scan — using always-on fallback until a scan succeeds.";
    case "last_scan":
      return `Using last scan — failed rescans keep this list until the next success.`;
  }
}

/** Short label for the live predicting panel. */
export function formatPredictingWatchlistHeadline(status: WatchlistScanStatus): string {
  switch (status.mode) {
    case "always_on":
      return "Predicting on always-on symbols";
    case "waiting_first_scan":
      return "Predicting on fallback symbols";
    case "last_scan":
      return "Predicting on dynamic EM watchlist";
  }
}

/** Match trader resolve_trading_watchlist (open positions merged at runtime in the bot). */
export function resolveEffectiveWatchlist(settings: Settings): string[] {
  if (!settings.watchlist_dynamic_enabled) {
    return stripBenchmark(settings, resolveWatchlistCore(settings));
  }
  if (!settings.watchlist_screener_ran_at) {
    return stripBenchmark(settings, resolveWatchlistCore(settings));
  }
  // After a successful scan, empty list is intentional (weak day / min-buy floor).
  const saved = (settings.watchlist ?? [])
    .map((symbol) => symbol.toUpperCase())
    .filter(Boolean);
  if (!saved.length) {
    return [];
  }
  return filterStaleCoreFromSaved(settings, saved);
}
