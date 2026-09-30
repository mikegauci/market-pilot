import type { Prediction, SignalForwardReturn, Trade } from "@/lib/types/database";

export type CalibrationSample = {
  probability: number;
  outcome: 0 | 1;
  source: "taken" | "rejected";
};

export type CalibrationBin = {
  binIndex: number;
  lo: number;
  hi: number;
  mid: number;
  n: number;
  hitRate: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  insufficient: boolean;
};

export type CalibrationResult = {
  samples: CalibrationSample[];
  bins: CalibrationBin[];
  brier: number | null;
  n: number;
};

const BIN_COUNT = 10;

function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom),
  };
}

export function takenTradeCalibrationSamples(trades: Trade[]): CalibrationSample[] {
  const out: CalibrationSample[] = [];
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    const reason = trade.exit_reason ?? "";
    if (reason !== "take_profit" && reason !== "stop_loss") continue;
    const p = trade.jev_buy_probability;
    if (p == null || !Number.isFinite(p)) continue;
    out.push({
      probability: Math.min(1, Math.max(0, p)),
      outcome: reason === "take_profit" ? 1 : 0,
      source: "taken",
    });
  }
  return out;
}

export function rejectedForwardCalibrationSamples(
  predictions: Prediction[],
  forwards: SignalForwardReturn[],
): CalibrationSample[] {
  const byPred = new Map(forwards.map((f) => [f.prediction_id, f]));
  const out: CalibrationSample[] = [];
  for (const pred of predictions) {
    if (pred.trade_created) continue;
    const fwd = byPred.get(pred.id);
    if (!fwd) continue;
    const p = pred.buy_probability;
    if (!Number.isFinite(p)) continue;
    out.push({
      probability: Math.min(1, Math.max(0, p)),
      outcome: fwd.forward_return > 0 ? 1 : 0,
      source: "rejected",
    });
  }
  return out;
}

export function brierScore(samples: CalibrationSample[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    sum += (s.probability - s.outcome) ** 2;
  }
  return sum / samples.length;
}

export function reliabilityBins(samples: CalibrationSample[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < BIN_COUNT; i++) {
    const lo = i / BIN_COUNT;
    const hi = (i + 1) / BIN_COUNT;
    const inBin = samples.filter((s) =>
      i === BIN_COUNT - 1
        ? s.probability >= lo && s.probability <= hi
        : s.probability >= lo && s.probability < hi,
    );
    const n = inBin.length;
    const successes = inBin.reduce((a, s) => a + s.outcome, 0);
    const hitRate = n > 0 ? successes / n : null;
    const ci = n > 0 ? wilsonInterval(successes, n) : null;
    bins.push({
      binIndex: i,
      lo,
      hi,
      mid: (lo + hi) / 2,
      n,
      hitRate,
      ciLow: ci?.low ?? null,
      ciHigh: ci?.high ?? null,
      insufficient: n < 5,
    });
  }
  return bins;
}

export function computeCalibration(
  samples: CalibrationSample[],
): CalibrationResult {
  return {
    samples,
    bins: reliabilityBins(samples),
    brier: brierScore(samples),
    n: samples.length,
  };
}
