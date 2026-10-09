import { DEFAULT_ENTRY_EMA_GATE } from "@/lib/entry-ema-gate";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import type { Settings } from "@/lib/types/database";

export type BreakoutRsiCap = { max_rsi: number; window_minutes: number };

/** Looser RSI cap the trader uses right after a breakout promotion, or null when it never applies. */
export function breakoutRsiCapForPacket(
  settings: Pick<
    Settings,
    | "watchlist_rotation_enabled"
    | "breakout_enabled"
    | "breakout_max_rsi"
    | "breakout_window_minutes"
    | "breakout_max_promotions_per_cycle"
    | "max_rsi"
  >,
): BreakoutRsiCap | null {
  if (
    !settings.watchlist_rotation_enabled ||
    !settings.breakout_enabled ||
    settings.breakout_max_promotions_per_cycle <= 0 ||
    settings.breakout_max_rsi <= settings.max_rsi
  ) {
    return null;
  }
  return {
    max_rsi: settings.breakout_max_rsi,
    window_minutes: settings.breakout_window_minutes,
  };
}

/** Built-in entry gates for OpenAI packets — matches live trader StrategyConfig defaults. */
export function traderBuiltInGatesForPacket(
  entryEmaGate: string = DEFAULT_ENTRY_EMA_GATE,
  entryFilterOverrides?: {
    max_rsi?: number;
    max_spread_pct?: number;
    breakout_rsi?: BreakoutRsiCap | null;
  },
) {
  const maxSpreadFraction =
    entryFilterOverrides?.max_spread_pct ?? STRATEGY_FILTER_THRESHOLDS.maxSpreadPct;
  return {
    max_spread_pct: maxSpreadFraction * 100,
    max_rsi: entryFilterOverrides?.max_rsi ?? STRATEGY_FILTER_THRESHOLDS.maxRsi,
    /** Applies instead of max_rsi for window_minutes after a breakout promotion; null = never. */
    breakout_rsi: entryFilterOverrides?.breakout_rsi ?? null,
    max_benchmark_drop_5m_pct: STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct,
    min_news_sentiment: STRATEGY_FILTER_THRESHOLDS.minNewsSentiment,
    entry_ema_gate: entryEmaGate,
    min_buy_hold_margin_pct: Math.round(STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin * 100),
    min_buy_sell_margin_pct: 10,
    news_block_tags: [...STRATEGY_FILTER_THRESHOLDS.newsBlockTags],
    block_on_earnings: false,
  };
}
