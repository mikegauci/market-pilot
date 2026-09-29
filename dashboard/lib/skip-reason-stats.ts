import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
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
  "reentry_cooldown",
]);

const IBKR_REASON_PREFIXES = [
  "ibkr_insufficient_buying_power",
  "ibkr_pending_entry_order",
  "ibkr_not_connected",
  "ibkr_order_failed",
  "ibkr_ineligible",
  "ibkr_cooldown",
] as const;

const TIER_SKIP_REASONS = new Set([
  "below_trade_threshold",
  "buy_hold_margin",
  "hold_dominant",
  "sell_dominant",
  "signal_not_eligible",
]);

export function normalizeSkipReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("awaiting_confirmation")) return "awaiting_confirmation";
  if (reason.startsWith("reentry_cooldown")) return "reentry_cooldown";
  if (reason.startsWith("correlation_cap")) return "correlation_cap";
  for (const prefix of IBKR_REASON_PREFIXES) {
    if (reason.startsWith(prefix)) return prefix;
  }
  for (const prefix of FILTER_PREFIXES) {
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
    reentry_cooldown: "Re-entry cooldown",
    ibkr_not_connected: "Broker not connected",
    ibkr_pending_entry_order: "Pending BUY order",
    ibkr_cooldown: "Broker cooldown",
    ibkr_ineligible: "Broker ineligible (KID / permission)",
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

/** Matches trader StrategyConfig.min_buy_hold_margin default (0.15). */
export function isTradeEligible(
  p: Prediction,
  minConfidence: number,
  minBuyHoldMargin: number = STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin,
): boolean {
  return (
    isHighBuySignal(p) &&
    p.buy_probability >= minConfidence &&
    p.buy_probability - p.hold_probability >= minBuyHoldMargin
  );
}

function isConfirmationBlocked(reason: string | null | undefined): boolean {
  return Boolean(reason?.startsWith("awaiting_confirmation"));
}

function isFilterBlocked(reason: string | null | undefined): boolean {
  const key = normalizeSkipReasonKey(reason);
  if (!key) return false;
  return FILTER_PREFIXES.includes(key);
}

function isRiskBlocked(reason: string | null | undefined): boolean {
  const key = normalizeSkipReasonKey(reason);
  if (!key) return false;
  if (RISK_REASONS.has(key)) return true;
  return IBKR_REASON_PREFIXES.some((p) => key.startsWith(p));
}

function isTierSkip(reason: string | null | undefined): boolean {
  const key = normalizeSkipReasonKey(reason);
  return key != null && TIER_SKIP_REASONS.has(key);
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

/**
 * Sequential funnel: each stage only counts predictions that cleared all prior stages.
 * Counts never increase later in the pipeline.
 */
export function buildSignalFunnel(
  predictions: Prediction[],
  recordThreshold: number,
  minConfidence: number,
  minBuyHoldMargin: number = STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin,
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

    if (!isTradeEligible(p, minConfidence, minBuyHoldMargin)) continue;
    // Tier skips (below threshold / margin) mean we never entered later gates.
    if (isTierSkip(p.trade_skip_reason)) continue;
    tradeEligible += 1;

    if (isConfirmationBlocked(p.trade_skip_reason)) continue;
    pastConfirmation += 1;

    if (isFilterBlocked(p.trade_skip_reason)) continue;
    pastFilters += 1;

    if (isRiskBlocked(p.trade_skip_reason)) continue;
    pastRisk += 1;

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

export type HourlyActivity = {
  hour: number;
  highBuy: number;
  tradeEligible: number;
  traded: number;
};

/**
 * Per-hour counts of strong BUY signals, trade-threshold hits, and trades opened.
 * Hours are UTC (matches prediction timestamps stored in Supabase).
 * Returns all 24 hours so quiet periods are visible.
 */
export function activityByHour(
  predictions: Prediction[],
  recordThreshold: number,
  minConfidence: number,
  minBuyHoldMargin: number = STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin,
): HourlyActivity[] {
  const buckets: HourlyActivity[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    highBuy: 0,
    tradeEligible: 0,
    traded: 0,
  }));

  for (const p of predictions) {
    if (p.buy_probability < recordThreshold || !isHighBuySignal(p)) continue;
    const hour = new Date(p.timestamp).getUTCHours();
    const bucket = buckets[hour]!;
    bucket.highBuy += 1;
    if (isTradeEligible(p, minConfidence, minBuyHoldMargin)) bucket.tradeEligible += 1;
    if (p.trade_created) bucket.traded += 1;
  }

  return buckets;
}
