import { describe, expect, it } from "vitest";
import {
  barFetchLimitForPreset,
  isChartPreset,
  sortBarsAscending,
} from "@/lib/chart-options";
import type { SymbolBar } from "@/lib/types/database";

function bar(ts: string): SymbolBar {
  return {
    id: Date.parse(ts) || 1,
    symbol: "AAPL",
    bar_size: "5 mins",
    ts,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    created_at: ts,
  };
}

describe("chart-options", () => {
  it("does not treat a bar size as a lookback preset", () => {
    expect(isChartPreset("4h")).toBe(true);
    expect(isChartPreset("5 mins")).toBe(false);
  });

  it("requests fewer bars for short lookback presets", () => {
    expect(barFetchLimitForPreset("4h")).toBeLessThan(500);
    expect(barFetchLimitForPreset("all")).toBe(500);
  });

  it("sorts bars ascending without truncating history", () => {
    const bars = [
      bar("2026-01-01T12:00:00Z"),
      bar("2026-01-01T06:00:00Z"),
      bar("2026-01-01T10:00:00Z"),
    ];
    expect(sortBarsAscending(bars).map((b) => b.ts)).toEqual([
      "2026-01-01T06:00:00Z",
      "2026-01-01T10:00:00Z",
      "2026-01-01T12:00:00Z",
    ]);
  });
});
