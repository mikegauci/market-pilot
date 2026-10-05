import { formatSkipReason } from "@/lib/prediction-skip-reason";
import type { MarketSnapshot, Prediction, Settings } from "@/lib/types/database";

/**
 * Built-in entry gates from trader/strategy/config.py StrategyConfig defaults.
 * Volume, share price, dollar volume, confirmation, and Jev confidence come from settings.
 */
const BUILT_IN_GATES = {
  max_spread_pct: 0.15,
  max_rsi: 70,
  max_benchmark_drop_5m_pct: -0.12,
  min_news_sentiment: -0.3,
  require_price_above_ema20: true,
  min_buy_hold_margin_pct: 15,
  min_buy_sell_margin_pct: 10,
  news_block_tags: [
    "downgrade",
    "lawsuit",
    "sec_investigation",
    "guidance_cut",
    "layoffs",
  ],
  block_on_earnings: false,
} as const;

function percentPoints(decimal: number): number {
  return Math.round(decimal * 1000) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type SkipExplainPacket = {
  note: string;
  symbol: string;
  timestamp: string;
  price: number;
  buy_pct: number;
  hold_pct: number;
  sell_pct: number;
  buy_minus_hold_pct_points: number;
  buy_minus_sell_pct_points: number;
  buy_minus_min_confidence_pct_points: number;
  skip_reason: string;
  skip_reason_label: string;
  snapshot: {
    spread_pct: number | null;
    rsi: number | null;
    ema_20: number | null;
    price_vs_ema20: "above" | "below" | "unknown";
    volume_ratio: number | null;
    share_price: number;
    benchmark_symbol: string;
    benchmark_change_5m_pct: number | null;
    news_sentiment: number | null;
    news_tags: string[];
    news_top_headline: string | null;
  };
  gates: {
    minimum_jev_confidence_pct: number;
    signal_record_threshold_pct: number;
    max_open_positions: number;
    min_volume_ratio: number;
    min_share_price: number;
    min_dollar_volume: number;
    confirmation_cycles: number;
    confirmation_seconds: number;
    max_spread_pct: number;
    max_rsi: number;
    max_benchmark_drop_5m_pct: number;
    min_news_sentiment: number;
    require_price_above_ema20: boolean;
    min_buy_hold_margin_pct: number;
    min_buy_sell_margin_pct: number;
    news_block_tags: string[];
    block_on_earnings: boolean;
    gates_note: string;
  };
};

export function buildSkipExplainPacket(
  prediction: Prediction,
  settings: Settings,
): SkipExplainPacket {
  const snapshot: MarketSnapshot = prediction.market_snapshot ?? {};
  const price = prediction.price;
  const spreadPct =
    snapshot.spread != null && price > 0 ? round3((snapshot.spread / price) * 100) : null;
  const buyPct = percentPoints(prediction.buy_probability);
  const holdPct = percentPoints(prediction.hold_probability);
  const sellPct = percentPoints(prediction.sell_probability);
  const minConfidencePct = percentPoints(settings.minimum_jev_confidence);
  const benchmarkChange =
    snapshot.benchmark_change_5m ?? snapshot.spy_change_5m ?? null;

  let priceVsEma: SkipExplainPacket["snapshot"]["price_vs_ema20"] = "unknown";
  if (snapshot.ema_20 != null) {
    priceVsEma = price > snapshot.ema_20 ? "above" : "below";
  }

  const reason = prediction.trade_skip_reason?.trim() || "unknown";

  return {
    note:
      "Percents are already in percent (85 means 85%). spread_pct and max_spread_pct are also percent of price (0.15 means 0.15%). Explain only this row. Do not invent prices, headlines, or other skips.",
    symbol: prediction.symbol,
    timestamp: prediction.timestamp,
    price,
    buy_pct: buyPct,
    hold_pct: holdPct,
    sell_pct: sellPct,
    buy_minus_hold_pct_points: round3(buyPct - holdPct),
    buy_minus_sell_pct_points: round3(buyPct - sellPct),
    buy_minus_min_confidence_pct_points: round3(buyPct - minConfidencePct),
    skip_reason: reason,
    skip_reason_label: formatSkipReason(reason) ?? reason,
    snapshot: {
      spread_pct: spreadPct,
      rsi: snapshot.rsi ?? null,
      ema_20: snapshot.ema_20 ?? null,
      price_vs_ema20: priceVsEma,
      volume_ratio: snapshot.volume_ratio ?? null,
      share_price: price,
      benchmark_symbol: settings.benchmark_symbol || "EEM",
      benchmark_change_5m_pct: benchmarkChange,
      news_sentiment: snapshot.news_sentiment ?? null,
      news_tags: snapshot.news_tags ?? [],
      news_top_headline: snapshot.news_top_headline ?? null,
    },
    gates: {
      minimum_jev_confidence_pct: minConfidencePct,
      signal_record_threshold_pct: percentPoints(settings.signal_record_threshold),
      max_open_positions: settings.max_open_positions,
      min_volume_ratio: settings.min_volume_ratio,
      min_share_price: settings.min_share_price,
      min_dollar_volume: settings.min_dollar_volume,
      confirmation_cycles: settings.confirmation_cycles,
      confirmation_seconds: settings.confirmation_seconds,
      max_spread_pct: BUILT_IN_GATES.max_spread_pct,
      max_rsi: BUILT_IN_GATES.max_rsi,
      max_benchmark_drop_5m_pct: BUILT_IN_GATES.max_benchmark_drop_5m_pct,
      min_news_sentiment: BUILT_IN_GATES.min_news_sentiment,
      require_price_above_ema20: BUILT_IN_GATES.require_price_above_ema20,
      min_buy_hold_margin_pct: BUILT_IN_GATES.min_buy_hold_margin_pct,
      min_buy_sell_margin_pct: BUILT_IN_GATES.min_buy_sell_margin_pct,
      news_block_tags: [...BUILT_IN_GATES.news_block_tags],
      block_on_earnings: BUILT_IN_GATES.block_on_earnings,
      gates_note:
        "Jev confidence, record threshold, max positions, volume, share price, dollar volume, and confirmation come from current settings. Spread, RSI, benchmark drop, news sentiment, EMA, buy margins, and news tags are the bot's built-in gates.",
    },
  };
}
