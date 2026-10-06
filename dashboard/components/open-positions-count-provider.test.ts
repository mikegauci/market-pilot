import { describe, expect, it } from "vitest";
import { positionsWithSsrFallback } from "@/components/open-positions-count-provider";
import type { Position } from "@/lib/types/database";

const serverRow: Position = {
  id: "1",
  symbol: "AAPL",
  quantity: 10,
  avg_cost: 100,
  market_price: 101,
  market_value: 1010,
  unrealized_pnl: 10,
  currency: "USD",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("positionsWithSsrFallback", () => {
  it("keeps SSR rows until the first live snapshot", () => {
    expect(
      positionsWithSsrFallback([serverRow], {
        positions: [],
        hasLiveSnapshot: false,
      }),
    ).toEqual([serverRow]);
  });

  it("trusts an empty live snapshot after the first poll", () => {
    expect(
      positionsWithSsrFallback([serverRow], {
        positions: [],
        hasLiveSnapshot: true,
      }),
    ).toEqual([]);
  });
});
