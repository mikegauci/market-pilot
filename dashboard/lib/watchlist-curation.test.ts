import { describe, expect, it } from "vitest";
import { parseWatchlistCurationPayload, parseWatchlistPins } from "@/lib/watchlist-curation";

describe("watchlist curation parse", () => {
  it("parses pin rows", () => {
    expect(
      parseWatchlistPins([
        { symbol: "tsm", locked: true, protect_demotion: false },
        { symbol: "BAD TICKER", locked: true, protect_demotion: true },
      ]),
    ).toEqual([{ symbol: "TSM", locked: true, protect_demotion: false }]);
  });

  it("parses save payload", () => {
    const parsed = parseWatchlistCurationPayload({
      watchlist_pins: [{ symbol: "INFY", locked: true, protect_demotion: true }],
      watchlist_dismissed: ["vale"],
    });
    expect(parsed.watchlist_pins[0]?.symbol).toBe("INFY");
    expect(parsed.watchlist_dismissed).toEqual(["VALE"]);
  });
});
