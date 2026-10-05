import { describe, expect, it } from "vitest";
import {
  formatPredictingWatchlistHeadline,
  resolveEffectiveWatchlist,
  stripBenchmark,
} from "@/lib/effective-watchlist";
import { settingsFixture } from "@/lib/test-support/settings";

describe("resolveEffectiveWatchlist", () => {
  it("returns configured watchlist without benchmark", () => {
    expect(resolveEffectiveWatchlist(settingsFixture())).toEqual(["BABA", "VALE", "NVDA"]);
  });

  it("strips benchmark symbol from watchlist", () => {
    expect(
      resolveEffectiveWatchlist(
        settingsFixture({ watchlist: ["BABA", "EEM", "VALE"], benchmark_symbol: "EEM" }),
      ),
    ).toEqual(["BABA", "VALE"]);
  });
});

describe("stripBenchmark", () => {
  it("removes benchmark symbol when configured", () => {
    expect(
      stripBenchmark(settingsFixture({ benchmark_symbol: "SPY" }), ["BABA", "SPY"]),
    ).toEqual(["BABA"]);
  });
});

describe("formatPredictingWatchlistHeadline", () => {
  it("formats symbol counts", () => {
    expect(formatPredictingWatchlistHeadline(0)).toBe("No symbols on watchlist");
    expect(formatPredictingWatchlistHeadline(1)).toBe("1 symbol on watchlist");
    expect(formatPredictingWatchlistHeadline(3)).toBe("3 symbols on watchlist");
  });
});
