import type { Prediction } from "@/lib/types/database";

export type SkipReasonBucket = {
  key: string;
  label: string;
  count: number;
};

export type SignalFunnel = {
  highBuySignals: number;
  tradeEligible: number;
  pastConfirmation: number;
  pastFilters: number;
  pastRisk: number;
  traded: number;
};

export type NearMissPrediction = Prediction & {
  marginToTrade: number;
};

const FILTER_PREFIXES = [
  "spread_too_wide",
  "rsi_overbought",
  "volume_too_low",
  "price_below_ema20",
  "benchmark_headwind",
  "spy_headwind",
  "news_sentiment_bearish",
  "news_block_tag",
  "news_earnings_window",
];

const RISK_REASONS = new Set([
  "bot_disabled",
  "already_open",
  "max_open_positions",
  "insufficient_capital",
  "max_daily_loss",
  "position_too_small",
  "invalid_price",
  "correlation_cap",
]);


export function normalizeSkipReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("awaiting_confirmation")) return "awaiting_confirmation";
  for (const prefix of [...FILTER_PREFIXES, ...IBKR_PREFIXES]) {
    if (reason.startsWith(prefix)) return prefix;
  }
  return reason;
}

export function skipReasonLabel(key: string): string {
  const labels: Record<string, string> = {
    below_trade_threshold: "Below confidence threshold",
    buy_hold_margin: "BUY–HOLD margin too narrow",
    hold_dominant: "HOLD dominant",
    sell_dominant: "SELL dominant",
    signal_not_eligible: "Signal not eligible",
    awaiting_confirmation: "Awaiting confirmation",
    spread_too_wide: "Spread too wide",
    rsi_overbought: "RSI overbought",
    volume_too_low: "Volume too low",
    price_below_ema20: "Price below EMA-20",
    benchmark_headwind: "Benchmark headwind",
    spy_headwind: "SPY headwind",
    news_sentiment_bearish: "Bearish news",
    news_block_tag: "Blocked news tag",
    news_earnings_window: "Earnings window",
    bot_disabled: "Auto-trading off",
    already_open: "Position already open",
    max_open_positions: "Max positions reached",
    insufficient_capital: "Insufficient capital",
    max_daily_loss: "Daily loss limit hit",
    position_too_small: "Position too small",
    invalid_price: "Invalid price",
    correlation_cap: "Correlation cap",
    ibkr_not_connected: "Broker not connected",
    ibkr_pending_entry_order: "Pending BUY order",
    ibkr_cooldown: "Broker cooldown",
    ibkr_insufficient_buying_power: "Insufficient buying power",
    ibkr_order_failed: "Broker order failed",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

function isHighBuySignal(p: Prediction): boolean {
  return (
    p.buy_probability > p.hold_probability &&
    p.buy_probability > p.sell_probability
  );
}

function isTradeEligible(p: Prediction, minConfidence: number): boolean {
  return (
    isHighBuySignal(p) &&
    p.buy_probability >= minConfidence &&
    p.buy_probability - p.hold_probability >= 0.05
  );
}

function isPastConfirmation(reason: string | null | undefined): boolean {
  if (!reason) return true;
  return !reason.startsWith("awaiting_confirmation");
}

function isPastFilters(reason: string | null | undefined): boolean {
  if (!reason) return true;
  const key = normalizeSkipReasonKey(reason);
  if (!key) return true;
  return !FILTER_PREFIXES.includes(key);
}

function isPastRisk(reason: string | null | undefined): boolean {
  if (!reason) return true;
  const key = normalizeSkipReasonKey(reason);
  if (!key) return true;
  if (RISK_REASONS.has(key)) return false;
  if (IBKR_PREFIXES.some((p) => key.startsWith(p))) return false;
  return true;
}

export function aggregateSkipReasons(predictions: Prediction[]): SkipReasonBucket[] {
  const map = new Map<string, number>();
  for (const p of predictions) {
    if (p.trade_created || !p.trade_skip_reason) continue;
    const key = normalizeSkipReasonKey(p.trade_skip_reason) ?? p.trade_skip_reason;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: skipReasonLabel(key), count }))
    .sort((a, b) => b.count - a.count);
}

export function buildSignalFunnel(
  predictions: Prediction[],
  recordThreshold: number,
  minConfidence: number,
): SignalFunnel {
  let highBuySignals = 0;
  let tradeEligible = 0;
  let pastConfirmation = 0;
  let pastFilters = 0;
  let pastRisk = 0;
  let traded = 0;

  for (const p of predictions) {
    if (p.buy_probability < recordThreshold || !isHighBuySignal(p)) continue;
    highBuySignals += 1;

    if (isTradeEligible(p, minConfidence)) tradeEligible += 1;
    if (isPastConfirmation(p.trade_skip_reason)) pastConfirmation += 1;
    if (isPastFilters(p.trade_skip_reason)) pastFilters += 1;
    if (isPastRisk(p.trade_skip_reason)) pastRisk += 1;
    if (p.trade_created) traded += 1;
  }

  return {
    highBuySignals,
    tradeEligible,
    pastConfirmation,
    pastFilters,
    pastRisk,
    traded,
  };
}

export function findNearMisses(
  predictions: Prediction[],
  recordThreshold: number,
  minConfidence: number,
): NearMissPrediction[] {
  return predictions
    .filter(
      (p) =>
        !p.trade_created &&
        isHighBuySignal(p) &&
        p.buy_probability >= recordThreshold &&
        p.buy_probability < minConfidence,
    )
    .map((p) => ({
      ...p,
      marginToTrade: minConfidence - p.buy_probability,
    }))
    .sort((a, b) => a.marginToTrade - b.marginToTrade)
    .slice(0, 10);
}

export function skipRateByHour(predictions: Prediction[]): { hour: number; skipRate: number; total: number }[] {
  const buckets = new Map<number, { skipped: number; total: number }>();
  for (const p of predictions) {
    const hour = new Date(p.timestamp).getHours();
    const bucket = buckets.get(hour) ?? { skipped: 0, total: 0 };
    bucket.total += 1;
    if (!p.trade_created && p.trade_skip_reason) bucket.skipped += 1;
    buckets.set(hour, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, { skipped, total }]) => ({
      hour,
      total,
      skipRate: total > 0 ? skipped / total : 0,
    }));
}
