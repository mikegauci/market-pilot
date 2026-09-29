/**
 * Default entry-filter thresholds — mirrors trader/strategy/config.py defaults.
 * Keep in sync when trader defaults change.
 */
export const STRATEGY_FILTER_THRESHOLDS = {
  maxRsi: 70,
  maxSpreadPct: 0.15,
  maxBenchmarkDrop5mPct: -0.3,
  minNewsSentiment: -0.3,
  requirePriceAboveEma20: true,
  /** 0 = disabled; set STRATEGY_MIN_VOLUME_RATIO in trader .env to enable */
  minVolumeRatio: 0,
  /** Mirrors StrategyConfig.min_buy_hold_margin / STRATEGY_MIN_BUY_HOLD_MARGIN */
  minBuyHoldMargin: 0.15,
  newsBlockTags: [
    "downgrade",
    "lawsuit",
    "sec_investigation",
    "guidance_cut",
    "layoffs",
  ],
} as const;
