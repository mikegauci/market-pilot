import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import type { MarketNewsRow, Prediction } from "@/lib/types/database";

export type MarketConditionLevel = "favorable" | "caution" | "headwind" | "closed" | "unknown";

export type MarketConditionFactor = {
  key: "session" | "benchmark" | "news";
  label: string;
  detail: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

export type MarketCondition = {
  level: MarketConditionLevel;
  label: string;
  summary: string;
  hint: string;
  factors: MarketConditionFactor[];
  benchmarkSymbol: string;
  benchmarkChange5m: number | null;
  newsSentiment: number | null;
  isMarketOpen: boolean;
};

const NEWS_LOOKBACK_MS = 6 * 60 * 60 * 1000;

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

export function averageRecentNewsSentiment(
  news: MarketNewsRow[],
  nowMs = Date.now(),
  lookbackMs = NEWS_LOOKBACK_MS,
): number | null {
  const scores: number[] = [];
  for (const row of news) {
    if (row.sentiment == null || !Number.isFinite(row.sentiment)) continue;
    const published = new Date(row.published_at).getTime();
    if (Number.isNaN(published)) continue;
    if (nowMs - published > lookbackMs) continue;
    scores.push(row.sentiment);
  }
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function benchmarkTone(
  change: number | null,
  floor: number,
): MarketConditionFactor["tone"] {
  if (change == null) return "neutral";
  if (change < floor) return "bad";
  if (change < 0) return "warn";
  return "good";
}

function newsTone(
  sentiment: number | null,
  minSentiment: number,
): MarketConditionFactor["tone"] {
  if (sentiment == null) return "neutral";
  if (sentiment <= minSentiment) return "bad";
  if (sentiment < -0.1) return "warn";
  if (sentiment > 0.1) return "good";
  return "neutral";
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatSentiment(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

/**
 * Score overall EM market conditions using the same thresholds the bot uses
 * for hard entry filters (benchmark 5m floor + news sentiment floor).
 */
export function assessMarketCondition(options: {
  isMarketOpen: boolean;
  benchmarkSymbol?: string;
  benchmarkChange5m?: number | null;
  newsSentiment?: number | null;
  maxBenchmarkDrop5mPct?: number;
  minNewsSentiment?: number;
}): MarketCondition {
  const benchmarkSymbol = (options.benchmarkSymbol ?? "EEM").toUpperCase();
  const floor =
    options.maxBenchmarkDrop5mPct ?? STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct;
  const minNews =
    options.minNewsSentiment ?? STRATEGY_FILTER_THRESHOLDS.minNewsSentiment;
  const change = options.benchmarkChange5m ?? null;
  const sentiment = options.newsSentiment ?? null;
  const isOpen = options.isMarketOpen;

  const factors: MarketConditionFactor[] = [
    {
      key: "session",
      label: "Session",
      detail: isOpen ? "US market open" : "US market closed",
      tone: isOpen ? "good" : "neutral",
    },
    {
      key: "benchmark",
      label: `Broad market (${benchmarkSymbol}, 5 min)`,
      detail:
        change == null
          ? "No recent reading"
          : `${formatSignedPct(change)} (cutoff ${floor}%)`,
      tone: benchmarkTone(change, floor),
    },
    {
      key: "news",
      label: "Recent news mood",
      detail:
        sentiment == null
          ? "No recent headlines"
          : `${formatSentiment(sentiment)} (blocks at ${minNews} or below)`,
      tone: newsTone(sentiment, minNews),
    },
  ];

  if (!isOpen) {
    return {
      level: "closed",
      label: "Closed",
      summary: "US market is closed. Figures below are the last readings for context.",
      hint: "The bot will not open new trades until the US session reopens. Open positions are still managed.",
      factors,
      benchmarkSymbol,
      benchmarkChange5m: change,
      newsSentiment: sentiment,
      isMarketOpen: false,
    };
  }

  if (change == null && sentiment == null) {
    return {
      level: "unknown",
      label: "Unknown",
      summary: "Waiting for market and news data from the trader.",
      hint: "No recommendation yet — check again once readings appear.",
      factors,
      benchmarkSymbol,
      benchmarkChange5m: change,
      newsSentiment: sentiment,
      isMarketOpen: true,
    };
  }

  const benchmarkBlocks = change != null && change < floor;
  const newsBlocks = sentiment != null && sentiment <= minNews;
  const benchmarkSoft = change != null && change < 0 && change >= floor;
  const newsSoft = sentiment != null && sentiment < -0.1 && sentiment > minNews;

  if (benchmarkBlocks || newsBlocks) {
    const drivers: string[] = [];
    if (benchmarkBlocks) drivers.push(`${benchmarkSymbol} too weak`);
    if (newsBlocks) drivers.push("bearish news");
    return {
      level: "headwind",
      label: "Headwind",
      summary: `The broad market or recent news looks weak enough that new buys are risky (${drivers.join(" · ")}).`,
      hint: "The bot blocks most new buys. Prefer waiting; losses here often come from the market, not a broken bot.",
      factors,
      benchmarkSymbol,
      benchmarkChange5m: change,
      newsSentiment: sentiment,
      isMarketOpen: true,
    };
  }

  if (benchmarkSoft || newsSoft) {
    return {
      level: "caution",
      label: "Caution",
      summary: "Conditions are a bit soft, but not weak enough to hard-block new buys.",
      hint: "These checks still allow new buys, but other filters may skip symbols. Be selective and keep sizing modest.",
      factors,
      benchmarkSymbol,
      benchmarkChange5m: change,
      newsSentiment: sentiment,
      isMarketOpen: true,
    };
  }

  return {
    level: "favorable",
    label: "Favorable",
    summary: "Broad market and news look OK for new trades on these checks.",
    hint: "These checks allow new buys; other filters may still skip symbols. If results are still weak, look at entries, exits, and risk settings — not this tape readout.",
    factors,
    benchmarkSymbol,
    benchmarkChange5m: change,
    newsSentiment: sentiment,
    isMarketOpen: true,
  };
}

export function marketConditionFromLiveData(options: {
  isMarketOpen: boolean;
  predictions: Prediction[];
  news: MarketNewsRow[];
  benchmarkSymbol?: string;
  nowMs?: number;
}): MarketCondition {
  const benchmarkSymbol = options.benchmarkSymbol ?? "EEM";
  return assessMarketCondition({
    isMarketOpen: options.isMarketOpen,
    benchmarkSymbol,
    benchmarkChange5m: extractBenchmarkChange5m(options.predictions, benchmarkSymbol),
    newsSentiment: averageRecentNewsSentiment(options.news, options.nowMs),
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
