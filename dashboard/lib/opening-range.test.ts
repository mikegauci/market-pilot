import { describe, expect, it } from "vitest";
import { openingRangeLevels, openingRangeOverlays } from "@/lib/opening-range";
import type { SymbolBar } from "@/lib/types/database";

// 2026-10-09 is EDT (UTC-4): 9:30 ET = 13:30Z.
function bar(iso: string, o: number, h: number, l: number, c: number): SymbolBar {
  return {
    id: 1,
    symbol: "NVDA",
    bar_size: "5 mins",
    ts: iso,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1000,
    created_at: iso,
  };
}

const day = [
  bar("2026-10-09T13:30:00Z", 100, 101, 99.5, 100.5),
  bar("2026-10-09T13:35:00Z", 100.5, 101.5, 100, 101),
  bar("2026-10-09T13:40:00Z", 101, 101.2, 100.2, 100.4),
];

describe("openingRangeLevels", () => {
  it("uses only the first bar for a 5 minute range", () => {
    expect(openingRangeLevels(day, 5)).toEqual({ day: "2026-10-09", high: 101, low: 99.5 });
  });

  it("spans three bars for a 15 minute range", () => {
    expect(openingRangeLevels(day, 15)).toEqual({ day: "2026-10-09", high: 101.5, low: 99.5 });
  });

  it("ignores pre-market bars and returns null when the window is incomplete", () => {
    const premarket = bar("2026-10-09T13:00:00Z", 90, 95, 89, 94);
    expect(openingRangeLevels([premarket, ...day], 5)?.high).toBe(101);
    expect(openingRangeLevels([day[0]!, day[2]!], 15)).toBeNull();
    expect(openingRangeLevels([premarket], 5)).toBeNull();
  });

  it("uses the newest session", () => {
    const yesterday = bar("2026-10-08T13:30:00Z", 80, 85, 79, 82);
    expect(openingRangeLevels([yesterday, ...day], 5)?.day).toBe("2026-10-09");
  });
});

describe("openingRangeOverlays", () => {
  it("returns a high and a low line", () => {
    const lines = openingRangeOverlays(day, 5);
    expect(lines.map((line) => [line.label, line.price])).toEqual([
      ["Range high", 101],
      ["Range low", 99.5],
    ]);
    expect(openingRangeOverlays([], 5)).toEqual([]);
  });
});
