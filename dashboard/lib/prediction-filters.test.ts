import { describe, expect, it } from "vitest";
import { evaluateEntryFilters } from "@/lib/prediction-filters";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";

describe("evaluateEntryFilters spread gate", () => {
  it("matches trader max spread (0.15% of price)", () => {
    const checks = evaluateEntryFilters({
      price: 100,
      spread: 0.2,
    });
    const spread = checks.find((row) => row.name === "Spread");
    expect(spread?.pass).toBe(false);
    expect(spread?.detail).toContain("0.200%");
    expect(spread?.detail).toContain("0.15%");
    expect(STRATEGY_FILTER_THRESHOLDS.maxSpreadPct).toBe(0.0015);
  });

  it("passes when spread is within 0.15%", () => {
    const checks = evaluateEntryFilters({
      price: 100,
      spread: 0.001,
    });
    const spread = checks.find((row) => row.name === "Spread");
    expect(spread?.pass).toBe(true);
  });

  it("omits benchmark headwind row when benchmark is not configured", () => {
    const checks = evaluateEntryFilters(
      { price: 100, benchmark_change_5m: -0.5 },
      { benchmarkSymbol: "" },
    );
    expect(checks.some((row) => row.name.endsWith(" 5m"))).toBe(false);
  });
});
