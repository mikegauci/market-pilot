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

  it("uses the active list when rotation is on", () => {
    expect(
      resolveEffectiveWatchlist(
        settingsFixture({
          watchlist: ["BABA"],
          watchlist_rotation_enabled: true,
          watchlist_active: ["NVDA", "AMD"],
          benchmark_symbol: "QQQ",
        }),
      ),
    ).toEqual(["NVDA", "AMD"]);
  });

  it("returns empty active when rotation is on but active is empty", () => {
    expect(
      resolveEffectiveWatchlist(
        settingsFixture({
          watchlist: ["BABA"],
          watchlist_rotation_enabled: true,
          watchlist_active: [],
          watchlist_pool: ["NVDA", "AMD", "QQQ"],
          benchmark_symbol: "QQQ",
        }),
      ),
    ).toEqual([]);
  });

  it("hides blocked symbols on the active list", () => {
    expect(
      resolveEffectiveWatchlist(
        settingsFixture({
          watchlist_rotation_enabled: true,
          watchlist_active: ["ISRG", "NVDA"],
          entry_blocked_symbols: ["ISRG"],
        }),
      ),
    ).toEqual(["NVDA"]);
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
