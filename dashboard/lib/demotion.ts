import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import type { Settings } from "@/lib/types/database";

function effectiveBenchmark(settings: Settings): string {
  return (settings.benchmark_symbol || "EEM").toUpperCase();
}

/** True when symbol is not on the base effective watchlist (ignoring open-position merge). */
export function isOffEffectiveWatchlist(symbol: string, settings: Settings): boolean {
  if (!settings.watchlist_dynamic_enabled) {
    return false;
  }
  if (!settings.watchlist_screener_ran_at) {
    return false;
  }

  const sym = symbol.toUpperCase();
  const benchmark = effectiveBenchmark(settings);
  if (sym === benchmark) {
    return false;
  }

  const base = new Set(resolveEffectiveWatchlist(settings).map((s) => s.toUpperCase()));
  return !base.has(sym);
}

/** True when demotion exit rules apply to this symbol. */
export function isDemotedSymbol(symbol: string, settings: Settings): boolean {
  if (!settings.demotion_exits_enabled) {
    return false;
  }
  return isOffEffectiveWatchlist(symbol, settings);
}
