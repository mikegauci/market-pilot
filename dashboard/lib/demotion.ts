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
  // Empty dynamic list = no names cleared the floor; don't demote the whole book.
  if (base.size === 0) {
    return false;
  }
  return !base.has(sym);
}

/** True when demotion exit rules apply to this symbol. */
export function isDemotedSymbol(symbol: string, settings: Settings): boolean {
  if (!settings.demotion_exits_enabled) {
    return false;
  }
  return isOffEffectiveWatchlist(symbol, settings);
}

/** Max hold minutes for a symbol, accounting for demotion ratio. Mirrors trader/watchlist/demotion.py. */
export function effectiveMaxHoldMinutes(symbol: string, settings: Settings): number {
  const base = settings.max_hold_minutes;
  if (base <= 0) return 0;
  if (!isDemotedSymbol(symbol, settings)) return base;
  const ratio = settings.demotion_max_hold_ratio;
  if (ratio <= 0) return 0.001;
  return base * ratio;
}
