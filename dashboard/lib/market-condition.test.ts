import { describe, expect, it } from "vitest";
import {
  assessMarketCondition,
  extractBenchmarkChange5m,
  marketConditionFromLiveData,
  median,
  mergeEvalScopeSymbols,
  openPositionMoves,
  watchlistMoveTone,
  watchlistMovesFromPredictions,
} from "@/lib/market-condition";
import type { Prediction } from "@/lib/types/database";

function prediction(
  symbol: string,
  snapshot: Prediction["market_snapshot"],
): Prediction {
  return {
    id: symbol,
    symbol,
    timestamp: "2026-10-02T14:00:00Z",
    price: 10,
    buy_probability: 0.5,
    hold_probability: 0.3,
    sell_probability: 0.2,
    trade_created: false,
    market_snapshot: snapshot,
    created_at: "2026-10-02T14:00:00Z",
  };
}

describe("median", () => {
  it("averages the two middle values for an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns the middle value for an odd count", () => {
    expect(median([-0.2, 0.1, 0.4])).toBe(0.1);
  });
});

describe("mergeEvalScopeSymbols", () => {
  it("merges watchlist and open positions without the benchmark", () => {
    expect(mergeEvalScopeSymbols(["BABA", "EEM"], ["VALE", "baba"], "EEM")).toEqual([
      "BABA",
      "VALE",
    ]);
  });
});

describe("extractBenchmarkChange5m", () => {
  it("returns null when no benchmark symbol is configured", () => {
    expect(
      extractBenchmarkChange5m(
        [prediction("BABA", { benchmark_change_5m: -0.1 })],
        "",
      ),
    ).toBeNull();
  });

  it("prefers the benchmark row then falls back to any snapshot", () => {
    expect(
      extractBenchmarkChange5m(
        [
          prediction("BABA", { benchmark_change_5m: -0.1 }),
          prediction("EEM", { benchmark_change_5m: 0.25 }),
        ],
        "EEM",
      ),
    ).toBe(0.25);
    expect(extractBenchmarkChange5m([prediction("BABA", { spy_change_5m: -0.4 })], "EEM")).toBe(
      -0.4,
    );
  });
});

describe("watchlistMoveTone", () => {
  it("classifies boundary moves for chips", () => {
    expect(watchlistMoveTone(null)).toBe("neutral");
    expect(watchlistMoveTone(0.01)).toBe("good");
    expect(watchlistMoveTone(0)).toBe("neutral");
    expect(watchlistMoveTone(-0.05)).toBe("warn");
    expect(watchlistMoveTone(-0.15)).toBe("bad");
  });
});

describe("openPositionMoves", () => {
  it("returns moves for symbols not on the watchlist", () => {
    const moves = [
      { symbol: "BABA", change5m: 0.2 },
      { symbol: "VALE", change5m: -0.1 },
    ];
    expect(openPositionMoves(moves, ["BABA"])).toEqual([{ symbol: "VALE", change5m: -0.1 }]);
  });
});

describe("watchlistMovesFromPredictions", () => {
  it("returns nothing when the eval scope is empty", () => {
    expect(
      watchlistMovesFromPredictions([prediction("BABA", { change_5m: 0.2 })], [], "EEM"),
    ).toEqual([]);
  });

  it("keeps scoped names and drops the benchmark", () => {
    const moves = watchlistMovesFromPredictions(
      [
        prediction("EEM", { change_5m: -0.4 }),
        prediction("BABA", { change_5m: 0.2 }),
        prediction("VALE", { change_5m: -0.1 }),
        prediction("NU", { change_5m: 0.05 }),
      ],
      ["BABA", "VALE", "EEM"],
      "EEM",
    );
    expect(moves.map((move) => move.symbol).sort()).toEqual(["BABA", "VALE"]);
  });

  it("does not fall back to every symbol when scope is empty", () => {
    expect(
      watchlistMovesFromPredictions([prediction("NU", { change_5m: -0.8 })], [], "EEM"),
    ).toEqual([]);
  });
});

describe("assessMarketCondition", () => {
  it("marks closed sessions", () => {
    const result = assessMarketCondition({
      isMarketOpen: false,
      moves: [{ symbol: "BABA", change5m: 0.2 }],
    });
    expect(result.level).toBe("closed");
    expect(result.label).toBe("Closed");
    expect(result.hint).toMatch(/will not open new trades/i);
    expect(result.medianChange5m).toBe(0.2);
  });

  it("marks favorable when the median is flat or up", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      moves: [
        { symbol: "BABA", change5m: 0.2 },
        { symbol: "VALE", change5m: -0.05 },
        { symbol: "NU", change5m: 0.4 },
      ],
    });
    expect(result.level).toBe("favorable");
    expect(result.summary).toMatch(/flat or up/i);
    expect(result.hint).toMatch(/only reflects your watchlist/i);
    expect(result.factors.find((factor) => factor.key === "watchlist")?.detail).toMatch(
      /\+0\.20% · 3 stocks/,
    );
  });

  it("marks caution when the median is down but above the floor", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      moves: [
        { symbol: "BABA", change5m: -0.08 },
        { symbol: "VALE", change5m: -0.02 },
      ],
    });
    expect(result.level).toBe("caution");
    expect(result.medianChange5m).toBeCloseTo(-0.05);
    expect(result.hint).toMatch(/conditions are a bit weak/i);
  });

  it("marks headwind when the median is below the floor", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      moves: [
        { symbol: "BABA", change5m: -0.4 },
        { symbol: "VALE", change5m: -0.2 },
        { symbol: "NU", change5m: 0.1 },
      ],
    });
    expect(result.level).toBe("headwind");
    expect(result.summary).toMatch(/more than 0\.12%/i);
    expect(result.factors.find((factor) => factor.key === "names")?.detail).toBe("1 up · 2 down");
  });

  it("marks unknown when no name has a 5-minute reading", () => {
    const result = assessMarketCondition({ isMarketOpen: true, moves: [] });
    expect(result.level).toBe("unknown");
    expect(result.hint).toMatch(/nothing to show yet/i);
  });
});

describe("marketConditionFromLiveData", () => {
  it("scores the watchlist and open positions in scope", () => {
    const result = marketConditionFromLiveData({
      isMarketOpen: true,
      benchmarkSymbol: "EEM",
      watchlist: ["BABA"],
      openSymbols: ["VALE"],
      predictions: [
        prediction("EEM", { benchmark_change_5m: -1 }),
        prediction("BABA", { change_5m: 0.3 }),
        prediction("VALE", { change_5m: 0.1 }),
        prediction("NU", { change_5m: -0.8 }),
      ],
    });
    expect(result.level).toBe("favorable");
    expect(result.medianChange5m).toBeCloseTo(0.2);
    expect(result.symbolCount).toBe(2);
  });

  it("is unknown when scope is empty even if other predictions exist", () => {
    const result = marketConditionFromLiveData({
      isMarketOpen: true,
      watchlist: [],
      openSymbols: [],
      predictions: [prediction("NU", { change_5m: -0.8 })],
    });
    expect(result.level).toBe("unknown");
    expect(result.symbolCount).toBe(0);
  });
});
