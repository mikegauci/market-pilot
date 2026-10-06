import { describe, expect, it } from "vitest";
import {
  formatGaugePercent,
  formatPriceMoveFromEntry,
  slProximityPct,
  tpProgressPct,
} from "@/lib/position-risk";

describe("slProximityPct", () => {
  const entry = 237.5;
  const stop = 236.76;

  it("is 0 at entry and 100 at the stop", () => {
    expect(slProximityPct(entry, stop, entry)).toBe(0);
    expect(slProximityPct(entry, stop, stop)).toBe(100);
    expect(slProximityPct(entry, stop, stop - 1)).toBe(100);
  });

  it("stays 0 while price is above entry", () => {
    expect(slProximityPct(entry, stop, entry + 1)).toBe(0);
  });

  it("is about halfway between entry and the stop", () => {
    const mid = (entry + stop) / 2;
    expect(slProximityPct(entry, stop, mid)).toBeCloseTo(50, 5);
  });

  it("returns null when the stop is not below entry", () => {
    expect(slProximityPct(entry, entry, entry - 1)).toBeNull();
  });
});

describe("formatGaugePercent", () => {
  it("rounds to the nearest whole percent, including up to 100", () => {
    expect(formatGaugePercent(99.4)).toBe("99%");
    expect(formatGaugePercent(99.5)).toBe("100%");
    expect(formatGaugePercent(100)).toBe("100%");
  });
});

describe("formatPriceMoveFromEntry", () => {
  it("states the real percent move, separate from stop progress", () => {
    expect(formatPriceMoveFromEntry(237.5, 236.76)).toBe("down 0.31% from entry");
    expect(formatPriceMoveFromEntry(100, 100)).toBe("at entry");
    expect(formatPriceMoveFromEntry(100, 101)).toBe("up 1.00% from entry");
  });
});

describe("tpProgressPct", () => {
  it("reaches 100 only at the target", () => {
    expect(tpProgressPct(100, 101.5, 100)).toBe(0);
    expect(tpProgressPct(100, 101.5, 101.5)).toBe(100);
    expect(tpProgressPct(100, 100, 101)).toBeNull();
  });
});
