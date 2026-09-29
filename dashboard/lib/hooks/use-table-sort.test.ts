import { describe, expect, it } from "vitest";
import {
  compareNullableNumber,
  compareNullableTime,
  compareNumber,
  compareString,
} from "@/lib/hooks/use-table-sort";

describe("compareNullableNumber", () => {
  it("keeps nulls last in both directions", () => {
    expect(compareNullableNumber(null, 1, "asc")).toBe(1);
    expect(compareNullableNumber(1, null, "asc")).toBe(-1);
    expect(compareNullableNumber(null, 1, "desc")).toBe(1);
    expect(compareNullableNumber(1, null, "desc")).toBe(-1);
    expect(compareNullableNumber(null, null, "desc")).toBe(0);
  });

  it("orders numbers by direction", () => {
    expect(compareNullableNumber(1, 2, "asc")).toBeLessThan(0);
    expect(compareNullableNumber(1, 2, "desc")).toBeGreaterThan(0);
  });
});

describe("compareNullableTime", () => {
  it("keeps nulls last in both directions", () => {
    expect(compareNullableTime(null, "2026-01-01T00:00:00Z", "desc")).toBe(1);
    expect(compareNullableTime("2026-01-01T00:00:00Z", null, "desc")).toBe(-1);
  });

  it("orders timestamps by direction", () => {
    expect(
      compareNullableTime("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "asc"),
    ).toBeLessThan(0);
    expect(
      compareNullableTime("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "desc"),
    ).toBeGreaterThan(0);
  });
});

describe("compareNumber / compareString", () => {
  it("respects direction", () => {
    expect(compareNumber(1, 2, "asc")).toBeLessThan(0);
    expect(compareNumber(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareString("a", "b", "asc")).toBeLessThan(0);
    expect(compareString("a", "b", "desc")).toBeGreaterThan(0);
  });
});
