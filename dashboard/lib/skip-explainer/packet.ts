import {
  formatSkipReason,
  isPreJevFilterSkip,
} from "@/lib/prediction-skip-reason";
import type { SkipExplanation } from "@/lib/skip-explainer/schema";
import {
  breakoutRsiCapForPacket,
  traderBuiltInGatesForPacket,
} from "@/lib/trader-built-in-gates";
import type { MarketSnapshot, Prediction, Settings } from "@/lib/types/database";

function percentPoints(decimal: number): number {
  return Math.round(decimal * 1000) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type SkipExplainPacket = {
  /** False when entry filters blocked before Jev; B/H/S zeros are placeholders. */
  jev_was_called: boolean;
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
  const builtIn = traderBuiltInGatesForPacket(settings.entry_ema_gate, {
    max_rsi: settings.max_rsi,
    max_spread_pct: settings.max_spread_pct,
    breakout_rsi: breakoutRsiCapForPacket(settings),
  });
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
  const jevWasCalled = !isPreJevFilterSkip(prediction);

  return {
    jev_was_called: jevWasCalled,
    note: jevWasCalled
      ? "Percents are already in percent (85 means 85%). spread_pct and max_spread_pct are percent of price (0.15 means 0.15%). Explain only this row. Do not invent prices, headlines, or other skips. Gates under settings are the bot's current dashboard settings, not necessarily what applied when this prediction was stored. When gates.breakout_rsi is set, a symbol promoted by a breakout uses that RSI cap instead of max_rsi for window_minutes; the row does not say whether this symbol was inside such a window, so mention both caps for an RSI skip."
      : "jev_was_called is false. Jev did not run on this eval — buy_pct, hold_pct, and sell_pct are storage placeholders (0), not model output. Explain the entry filter in skip_reason_label. Do not say Jev scored or recorded confidence.",
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
      benchmark_symbol: settings.benchmark_symbol || "",
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
        "Values under settings are current dashboard settings. Benchmark drop, news sentiment, buy margins, and news tags still come from trader env defaults unless noted.",
    },
  };
}

/** Skip OpenAI when Jev never ran — avoids "Jev recorded 0%" hallucinations. */
export function buildDeterministicPreJevSkipExplanation(
  packet: SkipExplainPacket,
): SkipExplanation {
  return {
    closeness: "hard_block",
    what_blocked_it: `${packet.skip_reason_label} — entry filter blocked ${packet.symbol} before Jev ran.`,
    summary: `Jev was not called on this eval. The 0% buy, hold, and sell values are placeholders the bot stores for filter skips, not Jev's signal. The bot logged "${packet.skip_reason}" (${packet.skip_reason_label}). Open the row snapshot for spread, RSI, EMA, volume, or news at eval time.`,
  };
}
