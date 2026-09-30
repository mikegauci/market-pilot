import type { Prediction } from "@/lib/types/database";

export type CalibrationBucket = {
  label: string;
  count: number;
  avgBuy: number;
  avgReturn15m: number;
};

const BUCKET_EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.01];

export function computeJevCalibration(
  predictions: Prediction[],
): CalibrationBucket[] {
  const withReturn = predictions.filter(
    (row) =>
      row.return_15m_pct != null &&
      Number.isFinite(row.return_15m_pct) &&
      row.buy_probability != null,
  );
  if (withReturn.length === 0) {
    return [];
  }

  const buckets: CalibrationBucket[] = [];
  for (let index = 0; index < BUCKET_EDGES.length - 1; index += 1) {
    const low = BUCKET_EDGES[index];
    const high = BUCKET_EDGES[index + 1];
    const rows = withReturn.filter(
      (row) => row.buy_probability >= low && row.buy_probability < high,
    );
    if (rows.length === 0) {
      continue;
    }
    const avgBuy =
      rows.reduce((sum, row) => sum + row.buy_probability, 0) / rows.length;
    const avgReturn15m =
      rows.reduce((sum, row) => sum + (row.return_15m_pct ?? 0), 0) / rows.length;
    buckets.push({
      label: `${Math.round(low * 100)}–${Math.round(Math.min(high, 1) * 100)}%`,
      count: rows.length,
      avgBuy,
      avgReturn15m,
    });
  }
  return buckets;
}
