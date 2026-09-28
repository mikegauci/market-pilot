import { describe, expect, it } from "vitest";
import { tradeForPosition } from "@/lib/trade-matching";
import type { Position, Trade } from "@/lib/types/database";

function position(symbol: string, quantity: number): Position {
  return {
    id: "pos-1",
    symbol,
    quantity,
    avg_cost: 100,
    market_price: 101,
    market_value: 101 * quantity,
    unrealized_pnl: 1,
    currency: "USD",
    updated_at: "2026-09-28T00:00:00Z",
  };
}

function trade(symbol: string, quantity: number, entryTime: string): Trade {
  return {
    id: `trade-${symbol}-${quantity}`,
    symbol,
    side: "buy",
    entry_time: entryTime,
    entry_price: 100,
    exit_time: null,
    exit_price: null,
    quantity,
    position_value: 100 * quantity,
    stop_loss: 99,
    take_profit: 101,
    gross_pnl: null,
    net_pnl: null,
    status: "open",
    paper_or_live: "paper",
    jev_buy_probability: 0.8,
    created_at: entryTime,
  };
}

describe("tradeForPosition", () => {
  it("returns undefined when no open trade matches", () => {
    expect(tradeForPosition(position("AAPL", 1), [])).toBeUndefined();
  });

  it("prefers exact quantity match among multiple open trades", () => {
    const openTrades = [
      trade("AAPL", 1, "2026-09-28T10:00:00Z"),
      trade("AAPL", 16, "2026-09-28T11:00:00Z"),
    ];
    const matched = tradeForPosition(position("AAPL", 16), openTrades);
    expect(matched?.quantity).toBe(16);
  });

  it("falls back to newest trade when quantity differs", () => {
    const openTrades = [
      trade("AAPL", 1, "2026-09-28T10:00:00Z"),
      trade("AAPL", 2, "2026-09-28T12:00:00Z"),
    ];
    const matched = tradeForPosition(position("AAPL", 99), openTrades);
    expect(matched?.id).toBe("trade-AAPL-2");
  });
});
