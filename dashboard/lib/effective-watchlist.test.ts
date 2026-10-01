import { describe, expect, it } from "vitest";
import {
  formatEmUniverseScanCountdown,
  formatPredictingWatchlistHeadline,
  formatWatchlistScanStatus,
  resolveEffectiveWatchlist,
  resolveEmUniverseScanSchedule,
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

  it("includes locked pin before first ranking score", () => {
    const settings = settingsFixture({
      watchlist: ["BABA"],
      watchlist_jev_rankings: [{ symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 }],
      watchlist_pins: [{ symbol: "INFY", locked: true, protect_demotion: false }],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["BABA", "INFY"]);
  });

  it("adds locked pins and removes dismissed symbols", () => {
    const settings = settingsFixture({
      watchlist: ["BABA", "VALE"],
      watchlist_jev_rankings: [
        { symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 },
        { symbol: "VALE", buy: 0.85, hold: 0.1, sell: 0.05, rank: 2 },
        { symbol: "TSM", buy: 0.7, hold: 0.2, sell: 0.1, rank: 3 },
      ],
      watchlist_pins: [{ symbol: "TSM", locked: true, protect_demotion: false }],
      watchlist_dismissed: ["VALE"],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["BABA", "TSM"]);
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

  it("resolves EM scan schedule like trader screener_due", () => {
    const now = new Date("2026-01-10T15:10:00Z");
    const base = settingsFixture({
      watchlist_refresh_minutes: 30,
      watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
    });
    const notDue = resolveEmUniverseScanSchedule(base, now);
    expect(notDue.visible).toBe(true);
    expect(notDue.dueNow).toBe(false);
    expect(notDue.nextScanAt?.toISOString()).toBe("2026-01-10T15:30:00.000Z");

    const due = resolveEmUniverseScanSchedule(
      settingsFixture({
        watchlist_refresh_minutes: 30,
        watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
      }),
      new Date("2026-01-10T15:31:00Z"),
    );
    expect(due.dueNow).toBe(true);
    expect(due.nextScanAt).toBeNull();
  });

  it("hides schedule when dynamic mode is off", () => {
    const schedule = resolveEmUniverseScanSchedule(
      settingsFixture({ watchlist_dynamic_enabled: false }),
    );
    expect(schedule.visible).toBe(false);
  });

  it("first scan pending is due now", () => {
    const schedule = resolveEmUniverseScanSchedule(
      settingsFixture({ watchlist_screener_ran_at: null }),
    );
    expect(schedule.dueNow).toBe(true);
    expect(formatEmUniverseScanCountdown(schedule)).toBe("EM scan due now");
  });

  it("formats countdown until next scan", () => {
    const schedule = resolveEmUniverseScanSchedule(
      settingsFixture({
        watchlist_refresh_minutes: 30,
        watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
      }),
      new Date("2026-01-10T15:10:00Z"),
    );
    expect(formatEmUniverseScanCountdown(schedule, new Date("2026-01-10T15:10:00Z"))).toBe(
      "Next full EM scan in 20m 0s",
    );
    expect(
      formatEmUniverseScanCountdown(schedule, new Date("2026-01-10T15:10:00Z"), "settings"),
    ).toBe("Next scan in 20m 0s.");
  });
});
