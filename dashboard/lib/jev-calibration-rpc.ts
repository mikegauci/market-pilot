import type { CalibrationBucket } from "@/lib/jev-calibration";

export class CalibrationFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationFetchError";
  }
}

export type CalibrationRpcRow = {
  label: string;
  bucket_count: number;
  avg_buy: number;
  avg_return_15m: number;
};

export function mapCalibrationRpcRows(data: unknown): CalibrationBucket[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((row: CalibrationRpcRow) => ({
    label: row.label,
    count: Number(row.bucket_count),
    avgBuy: Number(row.avg_buy),
    avgReturn15m: Number(row.avg_return_15m),
  }));
}
