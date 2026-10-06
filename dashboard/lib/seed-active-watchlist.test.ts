import { describe, expect, it } from "vitest";
import { seedActiveWatchlistFromPool } from "@/lib/seed-active-watchlist";

describe("seedActiveWatchlistFromPool", () => {
  it("skips blocked symbols and caps size", () => {
    expect(
      seedActiveWatchlistFromPool(
        ["ISRG", "NVDA", "AMD", "META"],
        ["ISRG"],
        2,
      ),
    ).toEqual(["NVDA", "AMD"]);
  });
});
