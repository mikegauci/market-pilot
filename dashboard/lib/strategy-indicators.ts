export type StrategyIndicator = {
  name: string;
  detail: string;
  usedFor: string;
};

/** Soft context sent to Jev with each prediction. */
export const JEV_INDICATORS: StrategyIndicator[] = [
  {
    name: "RSI (14)",
    detail: "Relative strength on 1-minute closes",
    usedFor: "Overbought/oversold context — Jev avoids extended entries",
  },
  {
    name: "EMA-9",
    detail: "Fast exponential moving average on 1-minute closes",
    usedFor: "Timing and short-term alignment (price vs fast trend, 9 vs 20 spread)",
  },
  {
    name: "EMA-20",
    detail: "Slower exponential moving average on 1-minute closes",
    usedFor: "Trend confirmation context for Jev alongside EMA-9",
  },
  {
    name: "Volume ratio",
    detail: "Latest 1-min volume vs 10-bar average",
    usedFor: "Participation and unusual-volume context for Jev",
  },
  {
    name: "Price change (5m / 15m)",
    detail: "Intraday momentum from aggregated 1-minute bars",
    usedFor: "Short-term momentum context for Jev",
  },
  {
    name: "Daily trend (1d / 5d / 1w)",
    detail: "Change vs prior daily closes",
    usedFor: "Swing regime context — secondary to intraday signals",
  },
  {
    name: "Benchmark 5m change",
    detail: "5-minute move in your benchmark symbol (default EEM)",
    usedFor: "Broad-market headwind context for Jev",
  },
  {
    name: "Bid–ask spread",
    detail: "Live quote spread as % of price",
    usedFor: "Execution quality context for Jev",
  },
  {
    name: "News sentiment & tags",
    detail: "Keyword scan of recent headlines (−1 to +1) plus event tags",
    usedFor: "Event-risk context for Jev; also shown on Predictions feed",
  },
];

/** Deterministic vetoes applied after Jev returns BUY. */
export const HARD_FILTER_RULES: StrategyIndicator[] = [
  {
    name: "RSI overbought",
    detail: "RSI (14) on 1-minute closes",
    usedFor: "Block entry when RSI > 70",
  },
  {
    name: "Below EMA-20",
    detail: "Price vs EMA-20 on 1-minute closes",
    usedFor: "Block entry when price ≤ EMA-20",
  },
  {
    name: "Benchmark headwind",
    detail: "Benchmark 5m change (default EEM)",
    usedFor: "Block entry when benchmark drops more than 0.3% in 5m",
  },
  {
    name: "Wide spread",
    detail: "Live bid–ask spread as % of price",
    usedFor: "Block entry when spread > 0.15%",
  },
  {
    name: "Bearish news",
    detail: "Headline sentiment score",
    usedFor: "Block entry when news_sentiment ≤ −0.3",
  },
  {
    name: "News block tags",
    detail: "downgrade, lawsuit, sec_investigation, guidance_cut, layoffs",
    usedFor: "Block entry when any blocking tag is present",
  },
  {
    name: "Low volume (optional)",
    detail: "Volume ratio vs 10-bar average",
    usedFor: "Block entry when volume_ratio below threshold — off by default (trader .env)",
  },
];

/** @deprecated Use JEV_INDICATORS + HARD_FILTER_RULES */
export const STRATEGY_INDICATORS = [...JEV_INDICATORS, ...HARD_FILTER_RULES];
