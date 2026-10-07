import { DEFAULT_ENTRY_EMA_GATE } from "@/lib/entry-ema-gate";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";

/** Built-in entry gates for OpenAI packets — matches live trader StrategyConfig defaults. */
export function traderBuiltInGatesForPacket(
  entryEmaGate: string = DEFAULT_ENTRY_EMA_GATE,
  entryFilterOverrides?: {
    max_rsi?: number;
    max_spread_pct?: number;
  },
) {
  const maxSpreadFraction =
    entryFilterOverrides?.max_spread_pct ?? STRATEGY_FILTER_THRESHOLDS.maxSpreadPct;
  return {
    max_spread_pct: maxSpreadFraction * 100,
    max_rsi: entryFilterOverrides?.max_rsi ?? STRATEGY_FILTER_THRESHOLDS.maxRsi,
    max_benchmark_drop_5m_pct: STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct,
    min_news_sentiment: STRATEGY_FILTER_THRESHOLDS.minNewsSentiment,
    entry_ema_gate: entryEmaGate,
    min_buy_hold_margin_pct: Math.round(STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin * 100),
    min_buy_sell_margin_pct: 10,
    news_block_tags: [...STRATEGY_FILTER_THRESHOLDS.newsBlockTags],
    block_on_earnings: false,
  };
}
