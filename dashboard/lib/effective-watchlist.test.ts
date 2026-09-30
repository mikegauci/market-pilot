import { describe, expect, it } from "vitest";
import {
  formatPredictingWatchlistHeadline,
  formatWatchlistScanStatus,
  resolveEffectiveWatchlist,
  resolveWatchlistScanStatus,
} from "@/lib/effective-watchlist";
import { settingsFixture } from "@/lib/test-support/settings";

describe("resolveEffectiveWatchlist", () => {
  it("uses core before first scan", () => {
    const settings = settingsFixture({
      watchlist: ["BABA", "VALE"],
      watchlist_screener_ran_at: null,
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["NVDA", "AAPL"]);
  });

  it("strips stale core from a pre-dynamic-only union", () => {
    const settings = settingsFixture({
      watchlist: ["NVDA", "AAPL", "BABA", "VALE", "EEM"],
      watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
      watchlist_jev_rankings: [
        { symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 },
        { symbol: "VALE", buy: 0.85, hold: 0.1, sell: 0.05, rank: 2 },
      ],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["BABA", "VALE"]);
  });

  it("keeps empty list after a successful weak scan", () => {
    const settings = settingsFixture({
      watchlist: [],
      watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
      watchlist_jev_rankings: [
        { symbol: "PDD", buy: 0.2, hold: 0.75, sell: 0.05, rank: 1 },
      ],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual([]);
  });

  it("reports scan status modes", () => {
    expect(
      resolveWatchlistScanStatus(
        settingsFixture({ watchlist_dynamic_enabled: false }),
      ).mode,
    ).toBe("always_on");
    expect(
      resolveWatchlistScanStatus(
        settingsFixture({ watchlist_screener_ran_at: null }),
      ).mode,
    ).toBe("waiting_first_scan");
    expect(
      resolveWatchlistScanStatus(
        settingsFixture({ watchlist_screener_ran_at: "2026-01-10T15:00:00Z" }),
      ).mode,
    ).toBe("last_scan");
  });

  it("formats scan status copy", () => {
    expect(formatWatchlistScanStatus({ mode: "waiting_first_scan" })).toContain(
      "Waiting for first scan",
    );
    expect(formatWatchlistScanStatus({ mode: "last_scan", ranAt: "2026-01-10T15:00:00Z" })).toContain(
      "Using last scan",
    );
  });

  it("formats predicting headline", () => {
    expect(formatPredictingWatchlistHeadline({ mode: "waiting_first_scan" })).toContain(
      "fallback",
    );
    expect(formatPredictingWatchlistHeadline({ mode: "last_scan", ranAt: "2026-01-10T15:00:00Z" })).toContain(
      "dynamic EM",
    );
  });
});
