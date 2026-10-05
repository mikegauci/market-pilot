/**
 * Default entry-filter thresholds — mirrors trader/strategy/config.py defaults.
 * Keep in sync when trader defaults change.
 */
export const STRATEGY_FILTER_THRESHOLDS = {
  maxRsi: 70,
  /** Fraction of price (0.0015 = 0.15%). Matches trader StrategyConfig.max_spread_pct. */
  maxSpreadPct: 0.0015,
  /** Percent points on 5m benchmark change. Matches trader max_benchmark_drop_5m_pct. */
  maxBenchmarkDrop5mPct: -0.12,
  minNewsSentiment: -0.3,
  requirePriceAboveEma20: true,
  /** 0 = disabled; set STRATEGY_MIN_VOLUME_RATIO in trader .env to enable */
  minVolumeRatio: 0,
  /** Dashboard default; 0 = off */
  minSharePrice: 20,
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
