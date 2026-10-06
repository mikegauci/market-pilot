import { describe, expect, it } from "vitest";
import {
  isValidWatchlistSymbol,
  mergeWatchlistSymbolLists,
  normalizeWatchlistSymbols,
  parseWatchlistCsv,
} from "@/lib/watchlist-symbols";

describe("watchlist-symbols", () => {
  it("normalizes and dedupes symbols", () => {
    expect(normalizeWatchlistSymbols([" nvda ", "NVDA", ""])).toEqual(["NVDA"]);
  });

  it("parses comma-separated bulk input", () => {
    expect(parseWatchlistCsv("aapl, msft,AAPL")).toEqual(["AAPL", "MSFT"]);
  });

  it("merges multiple lists", () => {
    expect(mergeWatchlistSymbolLists(["SPY"], ["spy", "QQQ"], undefined)).toEqual([
      "SPY",
      "QQQ",
    ]);
  });

  it("validates ticker pattern", () => {
    expect(isValidWatchlistSymbol("BRK.B")).toBe(true);
    expect(isValidWatchlistSymbol("123")).toBe(false);
  });
});
