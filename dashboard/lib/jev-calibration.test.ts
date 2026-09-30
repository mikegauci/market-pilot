import { describe, expect, it } from "vitest";
import { computeJevCalibration } from "@/lib/jev-calibration";
import type { Prediction } from "@/lib/types/database";

function prediction(buy: number, return15m: number | null): Prediction {
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

  it("buckets by buy probability and averages the forward return", () => {
    const buckets = computeJevCalibration([
      prediction(0.49, 0.5),
      prediction(0.55, 0.01),
      prediction(0.58, 0.03),
      prediction(0.72, -0.01),
      prediction(1, 0.04),
    ]);

    expect(buckets.map((bucket) => bucket.label)).toEqual(["50–60%", "70–80%", "90–100%"]);
    expect(buckets[0]).toMatchObject({ count: 2 });
    expect(buckets[0]?.avgBuy).toBeCloseTo(0.565);
    expect(buckets[0]?.avgReturn15m).toBeCloseTo(0.02);
    expect(buckets[1]?.avgReturn15m).toBeCloseTo(-0.01);
    expect(buckets[2]).toMatchObject({ count: 1, avgBuy: 1, avgReturn15m: 0.04 });
  });
});
