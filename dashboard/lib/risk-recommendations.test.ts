import { describe, expect, it } from "vitest";
import {
  areAllRecommendationsApplied,
  detectMatchingProfile,
  getRecommendedValuesForProfile,
  resolveRiskProfile,
  validateProfileSelection,
} from "@/lib/risk-recommendations";

const EQUITY = 1_000_000;

describe("getRecommendedValuesForProfile", () => {
  it("returns Medium preset at €1M", () => {
    expect(getRecommendedValuesForProfile(EQUITY, "medium")).toEqual({
      risk_per_trade: 2500,
      max_position_size: 5000,
      max_daily_loss: 10000,
    });
  });

  it("returns Low preset at €1M", () => {
    expect(getRecommendedValuesForProfile(EQUITY, "low")).toEqual({
      risk_per_trade: 1500,
      max_position_size: 3750,
      max_daily_loss: 7500,
    });
  });

  it("returns High preset at €1M", () => {
    expect(getRecommendedValuesForProfile(EQUITY, "high")).toEqual({
      risk_per_trade: 4000,
      max_position_size: 7500,
      max_daily_loss: 15000,
    });
  });
});

describe("areAllRecommendationsApplied", () => {
  it("returns true when values match selected profile", () => {
    const values = getRecommendedValuesForProfile(EQUITY, "high");
    expect(areAllRecommendationsApplied(values, EQUITY, "high")).toBe(true);
  });

  it("returns false when values match a different profile", () => {
    const values = getRecommendedValuesForProfile(EQUITY, "medium");
    expect(areAllRecommendationsApplied(values, EQUITY, "high")).toBe(false);
  });
});

describe("detectMatchingProfile", () => {
  it("detects the matching profile", () => {
    const values = getRecommendedValuesForProfile(EQUITY, "low");
    expect(detectMatchingProfile(values, EQUITY)).toBe("low");
  });

  it("returns null for custom values", () => {
    expect(
      detectMatchingProfile(
        { risk_per_trade: 123, max_position_size: 456, max_daily_loss: 789 },
        EQUITY,
      ),
    ).toBeNull();
  });
});

describe("resolveRiskProfile", () => {
  it("returns valid profiles unchanged", () => {
    expect(resolveRiskProfile("high")).toBe("high");
  });

  it("falls back for invalid or missing values", () => {
    expect(resolveRiskProfile(null)).toBe("medium");
    expect(resolveRiskProfile("invalid")).toBe("medium");
  });
});

describe("validateProfileSelection", () => {
  it("returns null when selection matches dollar values", () => {
    const values = getRecommendedValuesForProfile(EQUITY, "medium");
    expect(validateProfileSelection(values, EQUITY, "medium")).toBeNull();
  });

  it("blocks when values match one profile but another is selected", () => {
    const values = getRecommendedValuesForProfile(EQUITY, "high");
    const message = validateProfileSelection(values, EQUITY, "medium");
    expect(message).toContain("High");
    expect(message).toContain("Medium");
  });
});
