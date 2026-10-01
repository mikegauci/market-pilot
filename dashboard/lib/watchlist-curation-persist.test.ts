import { describe, expect, it } from "vitest";
import { buildWatchlistDisplayRows, resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { settingsFixture } from "@/lib/test-support/settings";

describe("watchlist curation persistence", () => {
  it("does not require saving scan symbols as explicit pins", () => {
    const settings = settingsFixture({
      watchlist: ["BABA", "VALE"],
      watchlist_jev_rankings: [
        { symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 },
        { symbol: "VALE", buy: 0.85, hold: 0.1, sell: 0.05, rank: 2 },
      ],
      watchlist_pins: [],
    });
    const display = buildWatchlistDisplayRows(settings, [], []);
    expect(display.map((row) => row.symbol)).toEqual(["BABA", "VALE"]);

    const afterScan = settingsFixture({
      ...settings,
      watchlist: ["INFY", "TSM"],
      watchlist_jev_rankings: [
        { symbol: "INFY", buy: 0.88, hold: 0.07, sell: 0.05, rank: 1 },
        { symbol: "TSM", buy: 0.82, hold: 0.1, sell: 0.08, rank: 2 },
      ],
      watchlist_pins: [],
    });
    expect(resolveEffectiveWatchlist(afterScan)).toEqual(["INFY", "TSM"]);
  });

  it("keeps only explicit unlocked pin across scan rotation", () => {
    const settings = settingsFixture({
      watchlist: ["INFY", "TSM"],
      watchlist_jev_rankings: [
        { symbol: "INFY", buy: 0.88, hold: 0.07, sell: 0.05, rank: 1 },
        { symbol: "TSM", buy: 0.82, hold: 0.1, sell: 0.08, rank: 2 },
      ],
      watchlist_pins: [{ symbol: "BABA", locked: false, protect_demotion: false }],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["INFY", "TSM", "BABA"]);
  });
});
