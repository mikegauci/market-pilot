import { describe, expect, it } from "vitest";
import { computeJevCalibration } from "@/lib/jev-calibration";
import type { Prediction } from "@/lib/types/database";

function prediction(
  buy: number,
  return15m: number | null,
): Prediction {
  return {
    id: crypto.randomUUID(),
    symbol: "TEST",
    buy_probability: buy,
    hold_probability: 0,
    sell_probability: 0,
    created_at: new Date().toISOString(),
    return_15m_pct: return15m,
  } as Prediction;
}

describe("computeJevCalibration", () => {
  it("returns empty when no forward returns", () => {
    expect(computeJevCalibration([prediction(0.8, null)])).toEqual([]);
  });

  it("buckets by buy probability", () => {
    const rows = [
      prediction(0.55, 0.01),
      prediction(0.58, 0.02),
      prediction(0.72, -0.01),
    ];
    const buckets = computeJevCalibration(rows);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    const low = buckets.find((b) => b.label.startsWith("50"));
    expect(low?.count).toBe(2);
  });
});
