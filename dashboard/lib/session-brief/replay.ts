const BAR_MS = 5 * 60_000;
const FLATTEN_BEFORE_CLOSE_MS = 10 * 60_000;

export type ReplayBar = {
  ts: string;
  high: number;
  low: number;
  close: number;
};

export type SkipOutcome =
  | "take_profit"
  | "stop_loss"
  | "soft_sell"
  | "soft_stop"
  | "timed_out"
  | "no_data";

export type SkipReplay = {
  outcome: SkipOutcome;
  /** Signed % move from entry to the simulated exit. */
  move_pct: number | null;
  max_up_pct: number | null;
  max_down_pct: number | null;
};

export type ReplayParams = {
  entryTs: string;
  entryPrice: number;
  bars: ReplayBar[];
  /** Decimal, e.g. 0.01 for 1%. */
  stopPct: number;
  takePct: number;
  maxHoldMinutes: number;
  /**
   * Early-exit bands as a fraction (0-1) of the way from entry to take-profit / stop.
   * Null or 0 turns the band off. A bar reaching the band exits at the band price.
   */
  softSellFraction?: number | null;
  softStopFraction?: number | null;
  /** Regular-session close; positions are flattened 10 minutes before it. */
  sessionClose: Date;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pctFrom(entry: number, price: number): number {
  return ((price - entry) / entry) * 100;
}

/**
 * Rough replay of the bot's bracket (fixed % stop and take-profit, max hold,
 * end-of-day flatten) on 5-minute bars that start at or after the entry time.
 * Soft sell / soft stop approximate the trader's early exits by the first bar that reaches the
 * band (the trader also needs repeated band hits and a Jev SELL signal, which are not stored).
 * A bar that touches both sides counts as the loss. Ignores fills and spread.
 */
export function replaySkip(params: ReplayParams): SkipReplay {
  const entryMs = new Date(params.entryTs).getTime();
  const { entryPrice } = params;
  const empty: SkipReplay = {
    outcome: "no_data",
    move_pct: null,
    max_up_pct: null,
    max_down_pct: null,
  };
  if (!Number.isFinite(entryMs) || !(entryPrice > 0)) return empty;

  const flattenMs = params.sessionClose.getTime() - FLATTEN_BEFORE_CLOSE_MS;
  // Max hold 0 means no time limit (same as the trader), so only the end-of-day flatten applies.
  const deadlineMs =
    params.maxHoldMinutes > 0
      ? Math.min(entryMs + params.maxHoldMinutes * 60_000, flattenMs)
      : flattenMs;
  const bars = params.bars
    .filter((bar) => {
      const ts = new Date(bar.ts).getTime();
      // Only bars that start after entry and finish before the exit deadline.
      return ts >= entryMs && ts + BAR_MS <= deadlineMs;
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (bars.length === 0) return empty;

  const stopPrice = entryPrice * (1 - params.stopPct);
  const takePrice = entryPrice * (1 + params.takePct);
  const softStopFraction = params.softStopFraction ?? 0;
  const softSellFraction = params.softSellFraction ?? 0;
  const softStopPrice =
    softStopFraction > 0 ? entryPrice * (1 - params.stopPct * softStopFraction) : null;
  const softSellPrice =
    softSellFraction > 0 ? entryPrice * (1 + params.takePct * softSellFraction) : null;
  let maxHigh = -Infinity;
  let minLow = Infinity;

  for (const bar of bars) {
    maxHigh = Math.max(maxHigh, bar.high);
    minLow = Math.min(minLow, bar.low);
    // Loss side first, so a bar touching both sides counts as the loss.
    let exit: { outcome: SkipOutcome; move: number } | null = null;
    if (bar.low <= stopPrice) {
      exit = { outcome: "stop_loss", move: -params.stopPct * 100 };
    } else if (softStopPrice != null && bar.low <= softStopPrice) {
      exit = { outcome: "soft_stop", move: -params.stopPct * softStopFraction * 100 };
    } else if (bar.high >= takePrice) {
      exit = { outcome: "take_profit", move: params.takePct * 100 };
    } else if (softSellPrice != null && bar.high >= softSellPrice) {
      exit = { outcome: "soft_sell", move: params.takePct * softSellFraction * 100 };
    }
    if (exit) {
      return {
        outcome: exit.outcome,
        move_pct: round2(exit.move),
        max_up_pct: round2(pctFrom(entryPrice, maxHigh)),
        max_down_pct: round2(pctFrom(entryPrice, minLow)),
      };
    }
  }

  return {
    outcome: "timed_out",
    move_pct: round2(pctFrom(entryPrice, bars[bars.length - 1].close)),
    max_up_pct: round2(pctFrom(entryPrice, maxHigh)),
    max_down_pct: round2(pctFrom(entryPrice, minLow)),
  };
}

/** Best and worst price reached between entry and exit, as % of the entry price. */
export function tradePath(params: {
  entryTs: string;
  exitTs: string;
  entryPrice: number;
  bars: ReplayBar[];
}): { max_up_pct: number; max_down_pct: number } | null {
  const entryMs = new Date(params.entryTs).getTime();
  const exitMs = new Date(params.exitTs).getTime();
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || !(params.entryPrice > 0)) {
    return null;
  }
  // Same window as replaySkip: bars that start after entry and end by the exit, so prices
  // from before the entry (or after the exit) never count.
  const inRange = params.bars.filter((bar) => {
    const ts = new Date(bar.ts).getTime();
    return ts >= entryMs && ts + BAR_MS <= exitMs;
  });
  if (inRange.length === 0) return null;
  const high = Math.max(...inRange.map((bar) => bar.high));
  const low = Math.min(...inRange.map((bar) => bar.low));
  return {
    max_up_pct: round2(pctFrom(params.entryPrice, high)),
    max_down_pct: round2(pctFrom(params.entryPrice, low)),
  };
}

export type TimeBucket = "open" | "midday" | "power_hour";

/** Buckets minutes-since-midnight US Eastern: open (to 10:30), midday, power hour (from 15:00). */
export function bucketTimeOfDay(etMinutes: number): TimeBucket {
  if (etMinutes < 10 * 60 + 30) return "open";
  if (etMinutes < 15 * 60) return "midday";
  return "power_hour";
}
