import type { StrategyDiagramType } from "@/lib/strategy-diagram-types";

export type StrategyIndicator = {
  name: string;
  headline: string;
  detail: string;
  usedFor: string;
  plainEnglish: string;
  /** Optional diagram key for strategy-diagrams.tsx */
  diagram?: StrategyDiagramType;
  /** Optional external learn-more URL */
  learnMoreUrl?: string;
};

/** Soft context sent to Jev with each prediction. */
export const JEV_INDICATORS: StrategyIndicator[] = [
  {
    name: "RSI (14)",
    headline: "Momentum gauge (RSI)",
    detail: "Relative strength on 1-minute closes",
    usedFor: "Overbought/oversold context — Jev avoids extended entries",
    plainEnglish:
      "Measures whether a stock has risen or fallen too fast. Above 70 means \"overheated\" — Jev treats that as risky.",
    diagram: "rsi",
    learnMoreUrl: "https://www.investopedia.com/terms/r/rsi.asp",
  },
  {
    name: "EMA-9",
    headline: "Short-term trend line (EMA-9)",
    detail: "Fast exponential moving average on 1-minute closes",
    usedFor: "Timing and short-term alignment (price vs fast trend, 9 vs 20 spread)",
    plainEnglish:
      "A fast-moving average that smooths out price noise. Helps Jev spot whether the stock is trending up right now.",
    diagram: "ema",
    learnMoreUrl: "https://www.investopedia.com/terms/e/ema.asp",
  },
  {
    name: "EMA-20",
    headline: "Medium-term trend line (EMA-20)",
    detail: "Slower exponential moving average on 1-minute closes",
    usedFor: "Trend confirmation context for Jev alongside EMA-9",
    plainEnglish:
      "A slower moving average that confirms the broader short-term trend. Price above EMA-20 is a bullish sign.",
    diagram: "ema",
    learnMoreUrl: "https://www.investopedia.com/terms/e/ema.asp",
  },
  {
    name: "Volume ratio",
    headline: "Trading activity",
    detail: "Latest 1-min volume vs 10-bar average",
    usedFor: "Participation and unusual-volume context for Jev",
    plainEnglish:
      "Compares current trading volume to the recent average. Low volume means fewer participants and harder fills.",
    diagram: "volume",
    learnMoreUrl: "https://www.investopedia.com/terms/v/volume.asp",
  },
  {
    name: "Price change (5m / 15m)",
    headline: "Recent price momentum",
    detail: "Intraday momentum from aggregated 1-minute bars",
    usedFor: "Short-term momentum context for Jev",
    plainEnglish:
      "How much the price has moved in the last 5 and 15 minutes. Helps Jev gauge whether momentum is building or fading.",
  },
  {
    name: "Daily trend (1d / 5d / 1w)",
    headline: "Longer-term trend",
    detail: "Change vs prior daily closes",
    usedFor: "Swing regime context — secondary to intraday signals",
    plainEnglish:
      "Shows whether the stock is up or down over the past day, 5 days, or week. Gives Jev background on the bigger picture — secondary to intraday signals.",
  },
  {
    name: "Benchmark 5m change",
    headline: "Broad market mood",
    detail: "5-minute move in your benchmark ETF (optional; off by default)",
    usedFor: "Broad-market headwind context for Jev when a benchmark is set",
    plainEnglish:
      "When configured, tracks how a broad-market ETF is moving. A falling benchmark creates headwinds for individual names.",
  },
  {
    name: "Bid–ask spread",
    headline: "Execution cost",
    detail: "Live quote spread as % of price",
    usedFor: "Execution quality context for Jev",
    plainEnglish:
      "The gap between buy and sell prices. A wide spread means you pay more to enter — Jev factors that into its decision.",
  },
  {
    name: "News sentiment & tags",
    headline: "Headline scan",
    detail: "Keyword scan of recent headlines (−1 to +1) plus event tags",
    usedFor: "Event-risk context for Jev; also shown on Predictions feed",
    plainEnglish:
      "Scans recent news for positive or negative keywords. Flags events like downgrades, lawsuits, or earnings.",
  },
];

/** Deterministic vetoes applied after Jev returns BUY. */
export const HARD_FILTER_RULES: StrategyIndicator[] = [
  {
    name: "RSI overbought",
    headline: "Too hot to buy",
    detail: "RSI (14) on 1-minute closes",
    usedFor: "Block entry when RSI > 70",
    plainEnglish:
      "If momentum is already stretched (RSI above 70), the bot skips the trade even when Jev says buy.",
    diagram: "rsi",
  },
  {
    name: "Below EMA-20",
    headline: "Trend not confirmed",
    detail: "Price vs EMA-20 on 1-minute closes (~20 min window)",
    usedFor: "Block entry when price ≤ EMA-20",
    plainEnglish:
      "Price must sit above the medium-term trend line. Below EMA-20 means the short-term trend isn't confirmed.",
    diagram: "ema",
  },
  {
    name: "EMA warming up",
    headline: "Not enough bars yet",
    detail: "EMA-20 needs ~20×1-minute bars after RTH open or restart",
    usedFor: "Block entry until EMA-20 is computed (fail-closed)",
    plainEnglish:
      "Right after the open or a restart, the bot waits for enough 1-minute history before it trusts the EMA gate.",
    diagram: "emaWarmup",
  },
  {
    name: "Benchmark headwind",
    headline: "Market drag",
    detail: "Benchmark 5m change (only when a benchmark symbol is set in settings)",
    usedFor: "Block entry when benchmark drops more than the configured 5m floor",
    plainEnglish:
      "If a benchmark ETF is configured and falling sharply, the bot waits for calmer conditions before entering.",
  },
  {
    name: "Wide spread",
    headline: "Poor fill quality",
    detail: "Live bid–ask spread as % of price",
    usedFor: "Block entry when spread > 0.15%",
    plainEnglish:
      "When the bid-ask gap is too wide, you lose money on entry. The bot skips trades where execution would be costly.",
  },
  {
    name: "Bearish news",
    headline: "Bad headlines",
    detail: "Headline sentiment score",
    usedFor: "Block entry when news_sentiment ≤ −0.3",
    plainEnglish:
      "Recent news is strongly negative. The bot won't enter while headline risk is elevated.",
  },
  {
    name: "News block tags",
    headline: "High-risk events",
    detail: "downgrade, lawsuit, sec_investigation, guidance_cut, layoffs",
    usedFor: "Block entry when any blocking tag is present",
    plainEnglish:
      "Specific red-flag events (downgrades, lawsuits, layoffs, etc.) automatically block new entries.",
  },
  {
    name: "Low volume (optional)",
    headline: "Thin trading",
    detail: "Volume ratio vs 10-bar average",
    usedFor: "Block entry when volume_ratio below threshold (default 0.5)",
    plainEnglish:
      "Blocks trades when volume is unusually low versus the recent 1-minute average. Adjust in Settings.",
    diagram: "volume",
  },
];

/** Applied in RiskManager after filters and Jev confirmation. */
export const RISK_CAP_RULES: StrategyIndicator[] = [
  {
    name: "Re-entry cooldown",
    headline: "Pause after exit",
    detail: "Minutes after closing a symbol before a new entry",
    usedFor: "Block entry when still inside cooldown window",
    plainEnglish:
      "Stops immediate re-chase in the same ticker after a stop or take-profit.",
    diagram: "reentry",
  },
  {
    name: "Max entries per symbol",
    headline: "Daily entry budget",
    detail: "New trades opened per symbol per US trading day",
    usedFor: "Block entry after the daily cap (0 = off)",
    plainEnglish:
      "Limits how many times the bot can re-enter the same name in one session day — useful when stops repeat.",
    diagram: "maxEntries",
  },
];

/** Watchlist rotation scoring (when enabled in Settings). */
export const ROTATION_RULES: StrategyIndicator[] = [
  {
    name: "Session vs open",
    headline: "Red-day filter",
    detail: "% change vs price when the market opened",
    usedFor: "Demote names below the session % floor from active scan",
    plainEnglish:
      "Keeps symbols that are down on the day from staying on the hot list, even if 5-minute momentum looks OK.",
    diagram: "sessionOpen",
  },
  {
    name: "Rotation pipeline",
    headline: "Pool → active list",
    detail: "Relative strength vs benchmark + volume/RSI tie-breakers",
    usedFor: "Swap weak active names for stronger pool candidates",
    plainEnglish:
      "On a timer, the bot re-scores the pool and swaps a few names, but never drops symbols with open trades.",
    diagram: "rotation",
  },
  {
    name: "Breakout promotion",
    headline: "Fast lane for surging names",
    detail: "New recent high + volume spike + 5m move beating the benchmark",
    usedFor: "Add a pool name to the active list between rotation scans",
    plainEnglish:
      "When a pool name suddenly surges, the bot adds it right away instead of waiting for the next scan. For a few minutes it gets a higher RSI cap and can't be swapped out. Jev still has to say BUY.",
    diagram: "breakout",
  },
  {
    name: "Red incumbents",
    headline: "Drop weak actives",
    detail: "Session-disqualified scores evict non-protected names",
    usedFor: "Remove red-day incumbents before picking challengers",
    plainEnglish:
      "If an active symbol falls below the session floor, it can leave the list on the next rotation even if it was on the list before. Open trades stay protected.",
    diagram: "sessionOpen",
  },
];

/** @deprecated Use JEV_INDICATORS + HARD_FILTER_RULES */
export const STRATEGY_INDICATORS = [...JEV_INDICATORS, ...HARD_FILTER_RULES];

export function withBenchmarkSymbol(
  items: StrategyIndicator[],
  benchmarkSymbol?: string,
): StrategyIndicator[] {
  if (!benchmarkSymbol) return items;
  return items.map((item) => {
    if (
      item.name === "Benchmark 5m change" ||
      item.name === "Benchmark headwind"
    ) {
      return {
        ...item,
        detail: item.detail.replace(/benchmark ETF \(optional[^)]*\)/i, benchmarkSymbol),
        plainEnglish: item.plainEnglish.replace(
          /benchmark ETF/gi,
          `${benchmarkSymbol} ETF`,
        ),
      };
    }
    return item;
  });
}
