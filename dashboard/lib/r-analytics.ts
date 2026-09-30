import type { Trade } from "@/lib/types/database";

export type AnalyticsMode = "paper" | "live" | "simulated" | "all";

export type EvidenceLevel = "insufficient" | "limited" | "ok";

export type TradeRPoint = {
  tradeId: string;
  symbol: string;
  rMultiple: number;
  pnl: number;
  riskDollars: number;
  entryTime: string;
  exitReason: string | null;
  buyProb: number | null;
};

export type ExpectancyResult = {
  n: number;
  meanR: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  evidence: EvidenceLevel;
  avgWinR: number | null;
  avgLossR: number | null;
  winRate: number;
};

export type BreakdownRow = {
  key: string;
  label: string;
  n: number;
  meanR: number | null;
  totalPnl: number;
};

function tradePnl(trade: Trade): number {
  return trade.net_pnl ?? trade.gross_pnl ?? 0;
}

export function filterTradesByMode(trades: Trade[], mode: AnalyticsMode): Trade[] {
  if (mode === "all") return trades;
  if (mode === "simulated") {
    return trades.filter((t) => (t.execution_mode ?? "ibkr") === "simulated");
  }
  if (mode === "live") {
    return trades.filter((t) => t.paper_or_live === "live");
  }
  // paper: paper_or_live paper, exclude pure simulated-only if labeled differently
  return trades.filter((t) => t.paper_or_live === "paper");
}

export function evidenceLevel(n: number): EvidenceLevel {
  if (n < 10) return "insufficient";
  if (n < 30) return "limited";
  return "ok";
}

export function evidenceLabel(level: EvidenceLevel): string {
  if (level === "insufficient") return "Insufficient evidence";
  if (level === "limited") return "Limited sample";
  return "Adequate sample";
}

/** Initial risk in dollars from stop distance; null if stop missing. */
export function riskDollars(trade: Trade): number | null {
  if (trade.stop_loss == null || trade.stop_loss <= 0) return null;
  const perShare = Math.abs(trade.entry_price - trade.stop_loss);
  if (!(perShare > 0) || !(trade.quantity > 0)) return null;
  return perShare * trade.quantity;
}

export function tradeRMultiple(trade: Trade): TradeRPoint | null {
  if (trade.status !== "closed") return null;
  const risk = riskDollars(trade);
  if (risk == null || risk <= 0) return null;
  const pnl = tradePnl(trade);
  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    rMultiple: pnl / risk,
    pnl,
    riskDollars: risk,
    entryTime: trade.entry_time,
    exitReason: trade.exit_reason ?? null,
    buyProb: trade.jev_buy_probability,
  };
}

export function collectRPoints(trades: Trade[]): TradeRPoint[] {
  const out: TradeRPoint[] = [];
  for (const trade of trades) {
    const point = tradeRMultiple(trade);
    if (point) out.push(point);
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

/** Deterministic LCG for reproducible bootstrap in tests. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCi(
  values: number[],
  opts?: { samples?: number; seed?: number },
): { mean: number | null; low: number | null; high: number | null } {
  if (values.length === 0) return { mean: null, low: null, high: null };
  const samples = opts?.samples ?? 1000;
  const rand = mulberry32(opts?.seed ?? 42);
  const m = mean(values)!;
  if (values.length === 1) return { mean: m, low: m, high: m };

  const means: number[] = [];
  const n = values.length;
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += values[Math.floor(rand() * n)]!;
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    mean: m,
    low: percentile(means, 0.025),
    high: percentile(means, 0.975),
  };
}

export function computeExpectancy(trades: Trade[], opts?: { seed?: number }): ExpectancyResult {
  const points = collectRPoints(trades);
  const rs = points.map((p) => p.rMultiple);
  const n = rs.length;
  const evidence = evidenceLevel(n);
  if (n === 0) {
    return {
      n: 0,
      meanR: null,
      ciLow: null,
      ciHigh: null,
      evidence,
      avgWinR: null,
      avgLossR: null,
      winRate: 0,
    };
  }
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const ci = bootstrapMeanCi(rs, { seed: opts?.seed ?? 42 });
  return {
    n,
    meanR: ci.mean,
    ciLow: evidence === "insufficient" ? null : ci.low,
    ciHigh: evidence === "insufficient" ? null : ci.high,
    evidence,
    avgWinR: mean(wins),
    avgLossR: mean(losses.map((r) => Math.abs(r))),
    winRate: wins.length / n,
  };
}

export function executionCosts(trades: Trade[]): number {
  let total = 0;
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    total += Math.abs(trade.slippage ?? 0) + Math.abs(trade.commission ?? 0);
  }
  return total;
}

/** Exposure ≈ sum(hold minutes) / wall-clock minutes spanning entries/exits. */
export function computeExposure(trades: Trade[]): number | null {
  const closed = trades.filter((t) => t.status === "closed" && t.exit_time);
  if (closed.length === 0) return null;
  let hold = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const trade of closed) {
    const entry = new Date(trade.entry_time).getTime();
    const exit = new Date(trade.exit_time!).getTime();
    if (!(exit > entry)) continue;
    hold += (exit - entry) / 60_000;
    minT = Math.min(minT, entry);
    maxT = Math.max(maxT, exit);
  }
  const wall = (maxT - minT) / 60_000;
  if (!(wall > 0)) return null;
  return hold / wall;
}

function hourEt(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value;
  return Number(hour ?? 0) % 24;
}

function buyBand(prob: number | null | undefined): string | null {
  if (prob == null || !Number.isFinite(prob)) return null;
  const clamped = Math.min(0.999, Math.max(0, prob));
  const lo = Math.floor(clamped / 0.05) * 0.05;
  const hi = lo + 0.05;
  return `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`;
}

function aggregateBreakdown(
  points: TradeRPoint[],
  keyFn: (p: TradeRPoint) => string | null,
  labelFn?: (key: string) => string,
): BreakdownRow[] {
  const map = new Map<string, { n: number; sumR: number; totalPnl: number }>();
  for (const p of points) {
    const key = keyFn(p);
    if (!key) continue;
    const row = map.get(key) ?? { n: 0, sumR: 0, totalPnl: 0 };
    row.n += 1;
    row.sumR += p.rMultiple;
    row.totalPnl += p.pnl;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([key, row]) => ({
      key,
      label: labelFn ? labelFn(key) : key,
      n: row.n,
      meanR: row.n > 0 ? row.sumR / row.n : null,
      totalPnl: row.totalPnl,
    }))
    .sort((a, b) => b.n - a.n);
}

export function breakdownBySymbol(trades: Trade[]): BreakdownRow[] {
  return aggregateBreakdown(collectRPoints(trades), (p) => p.symbol);
}

export function breakdownByHourEt(trades: Trade[]): BreakdownRow[] {
  return aggregateBreakdown(
    collectRPoints(trades),
    (p) => String(hourEt(p.entryTime)),
    (key) => `${key.padStart(2, "0")}:00 ET`,
  );
}

export function breakdownByExitReason(trades: Trade[]): BreakdownRow[] {
  return aggregateBreakdown(
    collectRPoints(trades),
    (p) => p.exitReason || "unknown",
  );
}

export function breakdownByBuyBand(trades: Trade[]): BreakdownRow[] {
  return aggregateBreakdown(collectRPoints(trades), (p) => buyBand(p.buyProb));
}

/** First skip/veto from prediction skip_reasons map keyed by trade id via prediction join is hard;
 *  use exit-adjacent: for analytics we accept optional skip reason from a map. */
export function breakdownByVeto(
  trades: Trade[],
  skipByTradeId?: Map<string, string>,
): BreakdownRow[] {
  const points = collectRPoints(trades).map((p) => ({
    ...p,
    veto: skipByTradeId?.get(p.tradeId) ?? null,
  }));
  const map = new Map<string, { n: number; sumR: number; totalPnl: number }>();
  for (const p of points) {
    const key = p.veto;
    if (!key) continue;
    const row = map.get(key) ?? { n: 0, sumR: 0, totalPnl: 0 };
    row.n += 1;
    row.sumR += p.rMultiple;
    row.totalPnl += p.pnl;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([key, row]) => ({
      key,
      label: key,
      n: row.n,
      meanR: row.n > 0 ? row.sumR / row.n : null,
      totalPnl: row.totalPnl,
    }))
    .sort((a, b) => b.n - a.n);
}

/** Annualized Sharpe from daily P&L series (sample stdev). */
export function sharpeFromDailyPnl(dailyPnls: number[]): number | null {
  if (dailyPnls.length < 5) return null;
  const m = mean(dailyPnls);
  if (m == null) return null;
  const variance =
    dailyPnls.reduce((sum, v) => sum + (v - m) ** 2, 0) / (dailyPnls.length - 1);
  const std = Math.sqrt(variance);
  if (!(std > 0)) return null;
  return (m / std) * Math.sqrt(252);
}
