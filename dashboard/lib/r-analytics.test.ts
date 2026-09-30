import { describe, expect, it } from "vitest";
import {
  bootstrapMeanCi,
  collectRPoints,
  computeExpectancy,
  evidenceLevel,
  filterTradesByMode,
  riskDollars,
  tradeRMultiple,
} from "@/lib/r-analytics";
import type { Trade } from "@/lib/types/database";

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "symbol">): Trade {
  return {
    side: "buy",
    entry_time: "2026-01-01T15:00:00Z",
    entry_price: 100,
    exit_time: "2026-01-01T15:30:00Z",
    exit_price: 101,
    quantity: 10,
    position_value: 1000,
    stop_loss: 99,
    take_profit: 102,
    gross_pnl: 10,
    net_pnl: 10,
    status: "closed",
    paper_or_live: "paper",
    jev_buy_probability: 0.9,
    execution_mode: "ibkr",
    exit_reason: "take_profit",
    created_at: "2026-01-01T15:00:00Z",
    ...partial,
  };
}

describe("filterTradesByMode", () => {
  const trades = [
    trade({ id: "1", symbol: "A", paper_or_live: "paper" }),
    trade({ id: "2", symbol: "B", paper_or_live: "live" }),
    trade({
      id: "3",
      symbol: "C",
      paper_or_live: "paper",
      execution_mode: "simulated",
    }),
  ];

  it("defaults to paper only", () => {
    const filtered = filterTradesByMode(trades, "paper");
    expect(filtered.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("isolates live", () => {
    expect(filterTradesByMode(trades, "live").map((t) => t.id)).toEqual(["2"]);
  });

  it("isolates simulated", () => {
    expect(filterTradesByMode(trades, "simulated").map((t) => t.id)).toEqual(["3"]);
  });
});

describe("R multiples", () => {
  it("computes R from stop distance", () => {
    // risk = |100-99|*10 = 10; pnl = 10 → 1R
    const point = tradeRMultiple(
      trade({ id: "a", symbol: "AAPL", net_pnl: 10, stop_loss: 99, quantity: 10 }),
    );
    expect(point?.rMultiple).toBeCloseTo(1);
    expect(riskDollars(trade({ id: "a", symbol: "AAPL" }))).toBe(10);
  });

  it("excludes trades without stop from R set", () => {
    const points = collectRPoints([
      trade({ id: "1", symbol: "A", stop_loss: null }),
      trade({ id: "2", symbol: "B", stop_loss: 99, net_pnl: -5 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.rMultiple).toBeCloseTo(-0.5);
  });
});

describe("expectancy + bootstrap", () => {
  it("marks empty as insufficient", () => {
    const result = computeExpectancy([]);
    expect(result.evidence).toBe("insufficient");
    expect(result.meanR).toBeNull();
  });

  it("bootstrap CI contains the mean for a fixed sample", () => {
    const values = [1, 1, 1, 0.5, -0.5, 2, -1];
    const ci = bootstrapMeanCi(values, { samples: 500, seed: 7 });
    expect(ci.mean).not.toBeNull();
    expect(ci.low!).toBeLessThanOrEqual(ci.mean!);
    expect(ci.high!).toBeGreaterThanOrEqual(ci.mean!);
  });

  it("evidence thresholds", () => {
    expect(evidenceLevel(5)).toBe("insufficient");
    expect(evidenceLevel(15)).toBe("limited");
    expect(evidenceLevel(40)).toBe("ok");
  });
});
