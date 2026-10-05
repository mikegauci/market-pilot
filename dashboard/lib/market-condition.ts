import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import type { Prediction } from "@/lib/types/database";

export type MarketConditionLevel = "favorable" | "caution" | "headwind" | "closed" | "unknown";

export type MarketConditionFactor = {
  key: "session" | "watchlist" | "names";
  label: string;
  detail: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

export type WatchlistMove = {
  symbol: string;
  change5m: number;
};

export type MarketCondition = {
  level: MarketConditionLevel;
  label: string;
  summary: string;
  hint: string;
  factors: MarketConditionFactor[];
  medianChange5m: number | null;
  symbolCount: number;
  isMarketOpen: boolean;
};

/** Same cutoff the bot uses for a weak benchmark print, applied here to the watchlist median. */
export const WATCHLIST_HEADWIND_FLOOR = STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct;

/**
 * Median of a list of numbers. Even counts average the two middle values,
 * matching Postgres percentile_cont(0.5).
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower == null || upper == null) return null;
  return (lower + upper) / 2;
}

/** Watchlist plus open positions — matches trader build_eval_symbols (minus benchmark). */
export function mergeEvalScopeSymbols(
  watchlist: string[] = [],
  openSymbols: string[] = [],
  benchmarkSymbol = "EEM",
): string[] {
  const benchmark = benchmarkSymbol.toUpperCase();
  const merged: string[] = [];
  for (const raw of [...watchlist, ...openSymbols]) {
    const symbol = raw.toUpperCase();
    if (!symbol || symbol === benchmark) continue;
    if (!merged.includes(symbol)) merged.push(symbol);
  }
  return merged;
}

export function extractBenchmarkChange5m(
  predictions: Prediction[],
  benchmarkSymbol = "EEM",
): number | null {
  const bench = benchmarkSymbol.toUpperCase();
  const preferred = predictions.find((p) => p.symbol.toUpperCase() === bench);
  const ordered = preferred ? [preferred, ...predictions] : predictions;

  for (const prediction of ordered) {
    const snap = prediction.market_snapshot;
    const value = snap?.benchmark_change_5m ?? snap?.spy_change_5m;
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

export function watchlistMovesFromPredictions(
  predictions: Prediction[],
  scopeSymbols: string[] = [],
  benchmarkSymbol = "EEM",
): WatchlistMove[] {
  const allowed = new Set(mergeEvalScopeSymbols(scopeSymbols, [], benchmarkSymbol));
  if (allowed.size === 0) return [];

  const benchmark = benchmarkSymbol.toUpperCase();
  const bySymbol = new Map<string, WatchlistMove>();

  for (const prediction of predictions) {
    const symbol = prediction.symbol.toUpperCase();
    if (!symbol || symbol === benchmark || !allowed.has(symbol)) continue;
    const change = prediction.market_snapshot?.change_5m;
    if (change == null || !Number.isFinite(change)) continue;
    bySymbol.set(symbol, { symbol, change5m: change });
  }

  return [...bySymbol.values()];
}

function moveTone(change: number | null, floor: number): MarketConditionFactor["tone"] {
  if (change == null) return "neutral";
  if (change < floor) return "bad";
  if (change < 0) return "warn";
  return "good";
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function breadthDetail(moves: WatchlistMove[], floor: number): string {
  let up = 0;
  let down = 0;
  let downHard = 0;
  for (const move of moves) {
    if (move.change5m < floor) downHard += 1;
    else if (move.change5m < 0) down += 1;
    else up += 1;
  }
  return `${up} steady or up · ${down} down a little · ${downHard} down a lot`;
}

function breadthTone(moves: WatchlistMove[], floor: number): MarketConditionFactor["tone"] {
  if (moves.length === 0) return "neutral";
  if (moves.some((move) => move.change5m < floor)) return "bad";
  if (moves.some((move) => move.change5m < 0)) return "warn";
  return "good";
}

function conditionFromMedian(
  medianChange: number | null,
  floor: number,
): Exclude<MarketConditionLevel, "closed"> {
  if (medianChange == null) return "unknown";
  if (medianChange < floor) return "headwind";
  if (medianChange < 0) return "caution";
  return "favorable";
}

/**
 * Score the watchlist from the median 5-minute move of its names.
 * Headwind is below the benchmark floor; caution is any smaller drop.
 */
export function assessMarketCondition(options: {
  isMarketOpen: boolean;
  moves?: WatchlistMove[];
  floor?: number;
}): MarketCondition {
  const floor = options.floor ?? WATCHLIST_HEADWIND_FLOOR;
  const moves = options.moves ?? [];
  const medianChange = median(moves.map((move) => move.change5m));
  const isOpen = options.isMarketOpen;
  const nameCount = moves.length;

  const factors: MarketConditionFactor[] = [
    {
      key: "session",
      label: "Session",
      detail: isOpen ? "US market open" : "US market closed",
      tone: isOpen ? "good" : "neutral",
    },
    {
      key: "watchlist",
      label: "Typical move (5 min)",
      detail:
        medianChange == null
          ? "No data yet"
          : `${formatSignedPct(medianChange)} · ${nameCount} ${nameCount === 1 ? "stock" : "stocks"}`,
      tone: moveTone(medianChange, floor),
    },
    {
      key: "names",
      label: "Each stock",
      detail: nameCount === 0 ? "Waiting for data" : breadthDetail(moves, floor),
      tone: breadthTone(moves, floor),
    },
  ];

  const base = {
    factors,
    medianChange5m: medianChange,
    symbolCount: nameCount,
    isMarketOpen: isOpen,
  };

  if (!isOpen) {
    return {
      ...base,
      level: "closed",
      label: "Closed",
      summary: "The US market is closed. The numbers below are the last readings we had.",
      hint: "The bot will not open new trades until the US session reopens. It still manages open positions.",
    };
  }

  const level = conditionFromMedian(medianChange, floor);

  if (level === "unknown") {
    return {
      ...base,
      level,
      label: "Unknown",
      summary: "Waiting for 5-minute price moves from your watchlist.",
      hint: "Nothing to show yet. Check back after the bot has scanned your stocks.",
    };
  }

  if (level === "headwind") {
    return {
      ...base,
      level,
      label: "Headwind",
      summary: `Your watchlist is down more than ${Math.abs(floor)}% on a typical stock over the last 5 minutes.`,
      hint: "Many stocks are weak at once. A falling market benchmark can still block new buys by itself.",
    };
  }

  if (level === "caution") {
    return {
      ...base,
      level,
      label: "Caution",
      summary: "Your watchlist is down slightly over the last 5 minutes.",
      hint: "Conditions are a bit weak. The bot may still skip individual stocks, and a weak benchmark can block new buys.",
    };
  }

  return {
    ...base,
    level: "favorable",
    label: "Favorable",
    summary: "Your watchlist is flat or up over the last 5 minutes.",
    hint: "This only reflects your watchlist. A weak benchmark or bad news can still stop new buys.",
  };
}

export function marketConditionFromLiveData(options: {
  isMarketOpen: boolean;
  predictions: Prediction[];
  watchlist?: string[];
  openSymbols?: string[];
  benchmarkSymbol?: string;
  floor?: number;
}): MarketCondition {
  const scope = mergeEvalScopeSymbols(
    options.watchlist,
    options.openSymbols,
    options.benchmarkSymbol,
  );
  return assessMarketCondition({
    isMarketOpen: options.isMarketOpen,
    floor: options.floor,
    moves: watchlistMovesFromPredictions(
      options.predictions,
      scope,
      options.benchmarkSymbol,
    ),
  });
}

export function marketConditionToneClass(level: MarketConditionLevel): string {
  switch (level) {
    case "favorable":
      return "text-emerald-400";
    case "caution":
      return "text-amber-400";
    case "headwind":
      return "text-red-400";
    case "closed":
      return "text-zinc-400";
    default:
      return "text-zinc-500";
  }
}

export function marketConditionDotClass(level: MarketConditionLevel): string {
  switch (level) {
    case "favorable":
      return "bg-emerald-400";
    case "caution":
      return "bg-amber-400";
    case "headwind":
      return "bg-red-400";
    case "closed":
      return "bg-zinc-500";
    default:
      return "bg-zinc-600";
  }
}

export function marketConditionFactorClass(
  tone: MarketConditionFactor["tone"],
): string {
  switch (tone) {
    case "good":
      return "text-emerald-400";
    case "warn":
      return "text-amber-400";
    case "bad":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}
