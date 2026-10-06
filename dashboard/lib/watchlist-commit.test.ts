import { describe, expect, it } from "vitest";
import { resolveSearchCommit, shouldWarnLargeWatchlist } from "@/lib/watchlist-commit";

const valid = (symbol: string) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol);

describe("resolveSearchCommit", () => {
  it("returns noop for empty input", () => {
    expect(resolveSearchCommit("  ", [])).toEqual({ kind: "noop" });
  });

  it("returns bulk for comma-separated input", () => {
    expect(resolveSearchCommit("AAPL, MSFT", [])).toEqual({
      kind: "bulk",
      raw: "AAPL, MSFT",
    });
  });

  it("adds when there is a single filter match", () => {
    expect(resolveSearchCommit("nvda", ["NVDA"], { isValidSymbol: valid })).toEqual({
      kind: "add",
      symbol: "NVDA",
    });
  });

  it("rejects ambiguous partial matches", () => {
    expect(resolveSearchCommit("A", ["AAPL", "AMZN", "AMD"], { isValidSymbol: valid })).toEqual({
      kind: "error",
      message: "Multiple matches — pick from the list or type the full ticker.",
    });
  });

  it("adds exact ticker when it appears among many matches", () => {
    expect(resolveSearchCommit("AMD", ["AAPL", "AMZN", "AMD"], { isValidSymbol: valid })).toEqual({
      kind: "add",
      symbol: "AMD",
    });
  });

  it("adds valid tickers not in the search index", () => {
    expect(resolveSearchCommit("PLTR", [], { isValidSymbol: valid })).toEqual({
      kind: "add",
      symbol: "PLTR",
    });
  });
});

describe("shouldWarnLargeWatchlist", () => {
  it("warns above 30 only", () => {
    expect(shouldWarnLargeWatchlist(30)).toBe(false);
    expect(shouldWarnLargeWatchlist(31)).toBe(true);
  });
});
