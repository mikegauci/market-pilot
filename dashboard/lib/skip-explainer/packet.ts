import { formatSkipReason } from "@/lib/prediction-skip-reason";
import { traderBuiltInGatesForPacket } from "@/lib/trader-built-in-gates";
import type { MarketSnapshot, Prediction, Settings } from "@/lib/types/database";

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
  gates: ReturnType<typeof traderBuiltInGatesForPacket> & {
    minimum_jev_confidence_pct: number;
    signal_record_threshold_pct: number;
    max_open_positions: number;
    min_volume_ratio: number;
    min_share_price: number;
    min_dollar_volume: number;
    confirmation_cycles: number;
    confirmation_seconds: number;
    gates_note: string;
  };
};

export function buildSkipExplainPacket(
  prediction: Prediction,
  settings: Settings,
): SkipExplainPacket {
  const builtIn = traderBuiltInGatesForPacket();
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
      "Percents are already in percent (85 means 85%). spread_pct and max_spread_pct are percent of price (0.15 means 0.15%). Explain only this row. Do not invent prices, headlines, or other skips. Gates under settings are the bot's current dashboard settings, not necessarily what applied when this prediction was stored.",
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
      ...builtIn,
      minimum_jev_confidence_pct: minConfidencePct,
      signal_record_threshold_pct: percentPoints(settings.signal_record_threshold),
      max_open_positions: settings.max_open_positions,
      min_volume_ratio: settings.min_volume_ratio,
      min_share_price: settings.min_share_price,
      min_dollar_volume: settings.min_dollar_volume,
      confirmation_cycles: settings.confirmation_cycles,
      confirmation_seconds: settings.confirmation_seconds,
      gates_note:
        "Jev confidence, record threshold, max positions, volume, share price, dollar volume, and confirmation are current settings. Spread, RSI, benchmark drop, news sentiment, EMA, buy margins, and news tags are the bot's built-in gates.",
    },
  };
}
