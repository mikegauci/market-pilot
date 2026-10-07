import { describe, expect, it } from "vitest";
import {
  tradeLifecycleDiff,
  tradeStatusSnapshot,
  watchlistDiff,
  watchlistToastDescription,
} from "@/lib/live-event-diff";
import type { Trade } from "@/lib/types/database";

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "symbol" | "status">): Trade {
  return {
    side: "buy",
    entry_time: "2026-03-26T14:00:00.000Z",
    entry_price: 100,
    exit_time: null,
    exit_price: null,
    quantity: 10,
    position_value: 1000,
    stop_loss: null,
    take_profit: null,
    gross_pnl: null,
    net_pnl: null,
    paper_or_live: "paper",
    jev_buy_probability: null,
    created_at: "2026-03-26T14:00:00.000Z",
    ...partial,
  };
}

describe("watchlistDiff", () => {
  it("returns null when lists match", () => {
    expect(watchlistDiff(["NVDA", "AMD"], ["AMD", "NVDA"])).toBeNull();
  });

  it("detects adds and removes", () => {
    expect(watchlistDiff(["NVDA"], ["NVDA", "AMD", "TSLA"])).toEqual({
      added: ["AMD", "TSLA"],
      removed: [],
    });
    expect(watchlistDiff(["NVDA", "AMD"], ["AMD"])).toEqual({
      added: [],
      removed: ["NVDA"],
    });
  });
});

describe("watchlistToastDescription", () => {
  it("formats both sides", () => {
    expect(
      watchlistToastDescription({ added: ["AMD"], removed: ["NVDA"] }),
    ).toBe("Added AMD. Removed NVDA");
  });
});

describe("tradeLifecycleDiff", () => {
  it("detects new opens and closes", () => {
    const prior = tradeStatusSnapshot([
      trade({ id: "1", symbol: "NVDA", status: "open" }),
    ]);
    const next = [
      trade({ id: "1", symbol: "NVDA", status: "closed", net_pnl: 12 }),
      trade({ id: "2", symbol: "AMD", status: "open" }),
    ];
    expect(tradeLifecycleDiff(prior, next)).toEqual({
      opened: [next[1]],
      closed: [next[0]],
    });
  });

  it("toasts close when a trade first appears already closed", () => {
    const prior = tradeStatusSnapshot([]);
    const closedRow = trade({ id: "9", symbol: "TSLA", status: "closed", net_pnl: -4 });
    expect(tradeLifecycleDiff(prior, [closedRow])).toEqual({
      opened: [],
      closed: [closedRow],
    });
  });

  it("does not re-close trades already in the snapshot", () => {
    const prior = tradeStatusSnapshot([
      trade({ id: "1", symbol: "NVDA", status: "closed" }),
    ]);
    const next = [trade({ id: "1", symbol: "NVDA", status: "closed", net_pnl: 12 })];
    expect(tradeLifecycleDiff(prior, next)).toEqual({ opened: [], closed: [] });
  });
});
