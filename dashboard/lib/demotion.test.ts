import { describe, expect, it } from "vitest";
import { effectiveMaxHoldMinutes, isDemotedSymbol, isOffEffectiveWatchlist } from "@/lib/demotion";
import { settingsFixture } from "@/lib/test-support/settings";

describe("demotion", () => {
  it("flags symbols off the effective watchlist", () => {
    expect(isOffEffectiveWatchlist("NU", settingsFixture())).toBe(true);
    expect(isOffEffectiveWatchlist("BABA", settingsFixture())).toBe(false);
    expect(isOffEffectiveWatchlist("EEM", settingsFixture())).toBe(false);
  });

  it("respects demotion_exits_enabled", () => {
    expect(isDemotedSymbol("NU", settingsFixture({ demotion_exits_enabled: false }))).toBe(
      false,
    );
    expect(isDemotedSymbol("NU", settingsFixture())).toBe(true);
  });

  it("shows off-watchlist badge even when demotion exits are disabled", () => {
    expect(
      isOffEffectiveWatchlist("NU", settingsFixture({ demotion_exits_enabled: false })),
    ).toBe(true);
  });

  it("does not demote when dynamic watchlist is empty after a scan", () => {
    const settings = settingsFixture({ watchlist: [] });
    expect(isOffEffectiveWatchlist("NU", settings)).toBe(false);
    expect(isDemotedSymbol("NU", settings)).toBe(false);
  });

  it("scales max hold by the demotion ratio", () => {
    const ranked = {
      max_hold_minutes: 100,
      watchlist: ["BABA"],
      watchlist_jev_rankings: [{ symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 }],
    };
    expect(effectiveMaxHoldMinutes("NU", settingsFixture(ranked))).toBe(50);
    expect(effectiveMaxHoldMinutes("BABA", settingsFixture(ranked))).toBe(100);
    expect(
      effectiveMaxHoldMinutes("NU", settingsFixture({ ...ranked, demotion_max_hold_ratio: 0 })),
    ).toBe(0.001);
  });
});
