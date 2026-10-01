import type { Settings, WatchlistPin } from "@/lib/types/database";
import { parseWatchlistDismissed, parseWatchlistPins } from "@/lib/watchlist-curation";

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

function buyBySymbol(settings: Settings): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of settings.watchlist_jev_rankings ?? []) {
    map.set(row.symbol.toUpperCase(), row.buy);
  }
  return map;
}

function symbolMeetsMinBuy(settings: Settings, symbol: string): boolean {
  const minBuy = settings.watchlist_min_buy ?? 0.6;
  const score = buyBySymbol(settings).get(symbol.toUpperCase());
  if (score == null) return false;
  return score >= minBuy;
}

function lockedPinIncludedInMerge(settings: Settings, symbol: string): boolean {
  const minBuy = settings.watchlist_min_buy ?? 0.6;
  const score = buyBySymbol(settings).get(symbol.toUpperCase());
  if (score == null) return true;
  return score >= minBuy;
}

function applyDismissedFilter(settings: Settings, symbols: string[]): string[] {
  const dismissed = new Set(parseWatchlistDismissed(settings.watchlist_dismissed));
  return symbols.filter((symbol) => !dismissed.has(symbol.toUpperCase()));
}

function mergeSymbolLists(...groups: string[][]): string[] {
  const merged: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const symbol = raw.toUpperCase();
      if (symbol && !merged.includes(symbol)) merged.push(symbol);
    }
  }
  return merged;
}

function mergeCuratedBaseWatchlist(
  settings: Settings,
  dynamicSymbols: string[],
): string[] {
  const pins = parseWatchlistPins(settings.watchlist_pins);
  const dynamicBase = applyDismissedFilter(settings, dynamicSymbols);
  const unlocked = pins
    .filter((pin) => !pin.locked)
    .map((pin) => pin.symbol);
  const locked = pins
    .filter((pin) => pin.locked && lockedPinIncludedInMerge(settings, pin.symbol))
    .map((pin) => pin.symbol);
  return stripBenchmark(settings, mergeSymbolLists(dynamicBase, unlocked, locked));
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

export type EmUniverseScanSchedule = {
  visible: boolean;
  dueNow: boolean;
  nextScanAt: Date | null;
  refreshMinutes: number;
};

export type EmUniverseScanScheduleInput = Pick<
  Settings,
  "watchlist_dynamic_enabled" | "watchlist_screener_ran_at" | "watchlist_refresh_minutes"
>;

function parseScanTimestamp(value: string): Date {
  return new Date(value);
}

/** Match trader watchlist.jev_screener.screener_due schedule (not deferrals). */
export function resolveEmUniverseScanSchedule(
  settings: EmUniverseScanScheduleInput,
  now: Date = new Date(),
): EmUniverseScanSchedule {
  const refreshMinutes = Math.max(1, settings.watchlist_refresh_minutes ?? 30);
  if (!settings.watchlist_dynamic_enabled) {
    return { visible: false, dueNow: false, nextScanAt: null, refreshMinutes };
  }
  const lastRaw = settings.watchlist_screener_ran_at;
  if (!lastRaw) {
    return { visible: true, dueNow: true, nextScanAt: null, refreshMinutes };
  }
  const last = parseScanTimestamp(lastRaw);
  const nextScanAt = new Date(last.getTime() + refreshMinutes * 60_000);
  const dueNow = now.getTime() >= nextScanAt.getTime();
  return { visible: true, dueNow, nextScanAt: dueNow ? null : nextScanAt, refreshMinutes };
}

function formatCountdownParts(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export type EmUniverseScanCountdownVariant = "overview" | "settings";

/** Short label for countdown UI (overview vs settings wording). */
export function formatEmUniverseScanCountdown(
  schedule: EmUniverseScanSchedule,
  now: Date = new Date(),
  variant: EmUniverseScanCountdownVariant = "overview",
): string {
  if (!schedule.visible) {
    return "";
  }
  if (schedule.dueNow) {
    if (variant === "settings") {
      return "Scan due now — may wait until market is open or bars are ready.";
    }
    return "EM scan due now";
  }
  if (!schedule.nextScanAt) {
    return variant === "settings" ? "Scan due now." : "EM scan due now";
  }
  const remainingSec = (schedule.nextScanAt.getTime() - now.getTime()) / 1000;
  const countdown = formatCountdownParts(remainingSec);
  if (variant === "settings") {
    return `Next scan in ${countdown}.`;
  }
  return `Next full EM scan in ${countdown}`;
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
  const saved = (settings.watchlist ?? [])
    .map((symbol) => symbol.toUpperCase())
    .filter(Boolean);
  const dynamicBase = saved.length
    ? filterStaleCoreFromSaved(settings, saved)
    : [];
  return mergeCuratedBaseWatchlist(settings, dynamicBase);
}

/** Preview effective list from explicit curation state (UI before save). */
export function resolveEffectiveWatchlistFromCuration(
  settings: Settings,
  pins: WatchlistPin[],
  dismissed: string[],
): string[] {
  const draft: Settings = {
    ...settings,
    watchlist_pins: pins,
    watchlist_dismissed: dismissed,
  };
  return resolveEffectiveWatchlist(draft);
}

/** Table rows: effective list + explicit pins (scan-only rows are not persisted). */
export function buildWatchlistDisplayRows(
  settings: Settings,
  explicitPins: WatchlistPin[],
  dismissed: string[],
): WatchlistPin[] {
  const dismissedSet = new Set(parseWatchlistDismissed(dismissed));
  const pinBySymbol = new Map(
    parseWatchlistPins(explicitPins).map((pin) => [pin.symbol, pin]),
  );
  const draft: Settings = {
    ...settings,
    watchlist_pins: explicitPins,
    watchlist_dismissed: dismissed,
  };
  const symbols = new Set<string>();
  for (const symbol of resolveEffectiveWatchlist(draft)) {
    if (!dismissedSet.has(symbol)) symbols.add(symbol);
  }
  for (const pin of explicitPins) {
    if (!dismissedSet.has(pin.symbol)) symbols.add(pin.symbol);
  }
  return [...symbols].sort().map((symbol) =>
    pinBySymbol.get(symbol) ?? {
      symbol,
      locked: false,
      protect_demotion: false,
    },
  );
}
