import { describe, expect, it } from "vitest";
import {
  computePositionSizing,
  isRiskPerTradeNonBinding,
  paperAvailableCash,
} from "@/lib/position-sizing";

describe("computePositionSizing", () => {
  it("binds max_position for medium profile at 1% stop", () => {
    const result = computePositionSizing({
      price: 50,
      riskPerTrade: 2500,
      stopLossPercentage: 0.01,
      maxPositionSize: 5000,
      availableCash: 1_000_000,
    });
    expect(result.sizingBinding).toBe("max_position");
    expect(result.plannedRiskUsd).toBeLessThan(2500);
    expect(result.ok).toBe(true);
  });

  it("reports risk_per_trade as non-binding when max position caps", () => {
    expect(isRiskPerTradeNonBinding(2500, 5000, 0.01)).toBe(true);
    expect(isRiskPerTradeNonBinding(50, 5000, 0.01)).toBe(false);
  });

  it("computes paper cash without broker cash", () => {
    expect(paperAvailableCash(10_000, 2500)).toBe(7500);
  });
});
