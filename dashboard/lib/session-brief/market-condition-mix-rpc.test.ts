import { describe, expect, it } from "vitest";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import { WATCHLIST_HEADWIND_FLOOR } from "@/lib/market-condition";

describe("session market condition mix RPC params", () => {
  it("uses the same headwind floor as live watchlist condition scoring", () => {
    expect(STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct).toBe(WATCHLIST_HEADWIND_FLOOR);
  });
});
