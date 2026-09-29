import { describe, expect, it } from "vitest";
import { initialDataChanged } from "@/lib/hooks/use-live-query";
import { applyChartFetchResult } from "@/components/symbol-chart-panel";
import type { SymbolBar } from "@/lib/types/database";

describe("initialDataChanged", () => {
  it("treats identical empty arrays as unchanged", () => {
    expect(initialDataChanged([], [])).toBe(false);
    expect(initialDataChanged([], [])).toBe(false);
  });

  it("treats same empty array reference as unchanged", () => {
    const empty: unknown[] = [];
    expect(initialDataChanged(empty, empty)).toBe(false);
  });

  it("detects length changes", () => {
    expect(initialDataChanged([1], [1, 2])).toBe(true);
    expect(initialDataChanged([1, 2], [])).toBe(true);
  });

  it("compares array object items shallowly by value, not identity", () => {
    const a = [{ id: "1", symbol: "AAPL", qty: 10 }];
    const b = [{ id: "1", symbol: "AAPL", qty: 10 }];
    expect(initialDataChanged(a, b)).toBe(false);

    const c = [{ id: "1", symbol: "AAPL", qty: 11 }];
    expect(initialDataChanged(a, c)).toBe(true);
  });

  it("compares plain objects shallowly", () => {
    expect(
      initialDataChanged(
        { enabled: true, last_heartbeat: "2026-01-01T00:00:00Z" },
        { enabled: true, last_heartbeat: "2026-01-01T00:00:00Z" },
      ),
    ).toBe(false);

    expect(
      initialDataChanged(
        { enabled: true, last_heartbeat: "2026-01-01T00:00:00Z" },
        { enabled: false, last_heartbeat: "2026-01-01T00:00:00Z" },
      ),
    ).toBe(true);
  });

  it("detects primitive changes", () => {
    expect(initialDataChanged(1, 1)).toBe(false);
    expect(initialDataChanged(1, 2)).toBe(true);
    expect(initialDataChanged("a", "a")).toBe(false);
  });
});

describe("applyChartFetchResult", () => {
  const sampleBars = [{ symbol: "AAPL" }] as SymbolBar[];

  it("clears errors on successful fetch", () => {
    expect(applyChartFetchResult("Failed to load chart data", { ok: true, bars: sampleBars })).toEqual(
      { bars: sampleBars, error: null },
    );
  });

  it("sets a default error on first failure", () => {
    expect(applyChartFetchResult(null, { ok: false })).toEqual({
      error: "Failed to load chart data",
    });
  });

  it("preserves an existing error message on later failure", () => {
    expect(applyChartFetchResult("Network down", { ok: false })).toEqual({
      error: "Network down",
    });
  });
});
