import { describe, expect, it } from "vitest";
import { compareNullableNumber, compareNullableTime } from "@/lib/hooks/use-table-sort";

describe("nullable table sort", () => {
  it("keeps null numbers last in both directions", () => {
    expect(compareNullableNumber(null, 1, "asc")).toBe(1);
    expect(compareNullableNumber(1, null, "asc")).toBe(-1);
    expect(compareNullableNumber(null, 1, "desc")).toBe(1);
    expect(compareNullableNumber(1, null, "desc")).toBe(-1);
    expect(compareNullableNumber(null, null, "desc")).toBe(0);
  });

  it("keeps null timestamps last in both directions", () => {
    expect(compareNullableTime(null, "2026-01-01T00:00:00Z", "asc")).toBe(1);
    expect(compareNullableTime("2026-01-01T00:00:00Z", null, "desc")).toBe(-1);
  });
});
