import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";

/** Built-in entry gates for OpenAI packets — matches live trader StrategyConfig defaults. */
export function traderBuiltInGatesForPacket() {
  return {
    max_spread_pct: STRATEGY_FILTER_THRESHOLDS.maxSpreadPct * 100,
    max_rsi: STRATEGY_FILTER_THRESHOLDS.maxRsi,
    max_benchmark_drop_5m_pct: STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct,
    min_news_sentiment: STRATEGY_FILTER_THRESHOLDS.minNewsSentiment,
    require_price_above_ema20: STRATEGY_FILTER_THRESHOLDS.requirePriceAboveEma20,
    min_buy_hold_margin_pct: Math.round(STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin * 100),
    min_buy_sell_margin_pct: 10,
    news_block_tags: [...STRATEGY_FILTER_THRESHOLDS.newsBlockTags],
    block_on_earnings: false,
  };
}
