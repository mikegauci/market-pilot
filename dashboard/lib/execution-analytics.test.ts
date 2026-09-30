import { describe, expect, it } from "vitest";
import {
  maeMfeScatter,
  slippageHistogram,
  totalExecutionCost,
} from "@/lib/execution-analytics";
import type { Trade } from "@/lib/types/database";

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "symbol">): Trade {
  return {
    side: "buy",
    entry_time: "2026-01-01T15:00:00Z",
    entry_price: 100,
    exit_time: "2026-01-01T16:00:00Z",
    exit_price: 101,
    quantity: 1,
    position_value: 100,
    stop_loss: 99,
    take_profit: 102,
    gross_pnl: 1,
    net_pnl: 1,
    status: "closed",
    paper_or_live: "paper",
    jev_buy_probability: 0.8,
    created_at: "2026-01-01T15:00:00Z",
    ...partial,
  };
}

describe("execution analytics", () => {
  it("builds slippage histogram", () => {
    const buckets = slippageHistogram([
      trade({ id: "1", symbol: "A", slippage: 0.5 }),
      trade({ id: "2", symbol: "B", slippage: -0.2 }),
      trade({ id: "3", symbol: "C", slippage: 0.5 }),
    ]);
    expect(buckets.some((b) => b.count > 0)).toBe(true);
  });

  it("scatters MAE/MFE for closed trades", () => {
    const points = maeMfeScatter([
      trade({ id: "1", symbol: "A", mae: -1, mfe: 2, net_pnl: 5 }),
      trade({ id: "2", symbol: "B", mae: null, mfe: 1 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.win).toBe(true);
  });

  it("sums execution costs", () => {
    const costs = totalExecutionCost([
      trade({ id: "1", symbol: "A", slippage: -2, commission: 1 }),
      trade({ id: "2", symbol: "B", slippage: 3, commission: 0 }),
    ]);
    expect(costs.slippageAbs).toBe(5);
    expect(costs.commission).toBe(1);
    expect(costs.total).toBe(6);
  });
});
