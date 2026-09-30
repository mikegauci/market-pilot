import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHART_PRESET,
  isChartPreset,
  lookbackMsForPreset,
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
  it("recognizes lookback presets", () => {
    expect(isChartPreset("4h")).toBe(true);
    expect(isChartPreset("1h")).toBe(true);
    expect(isChartPreset("all")).toBe(true);
    expect(isChartPreset("5 mins")).toBe(false);
  });

  it("defaults to 4H lookback", () => {
    expect(DEFAULT_CHART_PRESET).toBe("4h");
    expect(lookbackMsForPreset("4h")).toBe(4 * 60 * 60 * 1000);
    expect(lookbackMsForPreset("all")).toBeNull();
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
