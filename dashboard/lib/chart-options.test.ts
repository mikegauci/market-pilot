import { describe, expect, it } from "vitest";
import {
  defaultRangeForInterval,
  filterBarsForChart,
  isChartInterval,
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
  it("recognizes supported intervals", () => {
    expect(isChartInterval("5 mins")).toBe(true);
    expect(isChartInterval("1 day")).toBe(true);
    expect(isChartInterval("1 hour")).toBe(false);
  });

  it("defaults to the shortest lookback per interval", () => {
    expect(defaultRangeForInterval("5 mins")).toBe("4h");
    expect(defaultRangeForInterval("1 day")).toBe("1m");
  });

  it("sorts bars ascending and keeps all when range is all", () => {
    const bars = [bar("2026-01-01T12:00:00Z"), bar("2026-01-01T10:00:00Z")];
    const filtered = filterBarsForChart(bars, "5 mins", "all");
    expect(filtered.map((b) => b.ts)).toEqual([
      "2026-01-01T10:00:00Z",
      "2026-01-01T12:00:00Z",
    ]);
  });

  it("keeps only bars inside the lookback window", () => {
    const bars = [
      bar("2026-01-01T08:00:00Z"),
      bar("2026-01-01T10:00:00Z"),
      bar("2026-01-01T12:00:00Z"),
    ];
    const filtered = filterBarsForChart(bars, "5 mins", "4h");
    expect(filtered.map((b) => b.ts)).toEqual([
      "2026-01-01T08:00:00Z",
      "2026-01-01T10:00:00Z",
      "2026-01-01T12:00:00Z",
    ]);

    const tight = [
      bar("2026-01-01T06:00:00Z"),
      bar("2026-01-01T10:00:00Z"),
      bar("2026-01-01T12:00:00Z"),
    ];
    expect(filterBarsForChart(tight, "5 mins", "4h").map((b) => b.ts)).toEqual([
      "2026-01-01T10:00:00Z",
      "2026-01-01T12:00:00Z",
    ]);
  });
});
