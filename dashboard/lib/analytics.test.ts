import { describe, expect, it } from "vitest";
import { buildEquitySeries, maxDrawdownPct } from "@/lib/portfolio-analytics";
import { computeTradeStats, exitReasonLabel } from "@/lib/trade-analytics";
import type { PortfolioSnapshot, Trade } from "@/lib/types/database";

describe("portfolio-analytics", () => {
  it("computes drawdown from equity series", () => {
    const history: PortfolioSnapshot[] = [
      {
        id: "1",
        timestamp: "2026-01-01T10:00:00Z",
        balance: 0,
        equity: 100,
        daily_pnl: 0,
        total_pnl: 0,
        currency: "USD",
        created_at: "",
      },
      {
        id: "2",
        timestamp: "2026-01-01T11:00:00Z",
        balance: 0,
        equity: 90,
        daily_pnl: -10,
        total_pnl: -10,
        currency: "USD",
        created_at: "",
      },
    ];
    const series = buildEquitySeries(history);
    expect(series[1]?.drawdownPct).toBeCloseTo(-10);
    expect(maxDrawdownPct(history)).toBeCloseTo(-10);
  });
});

describe("trade-analytics", () => {
  it("computes win rate from closed trades", () => {
    const trades: Trade[] = [
      {
        id: "1",
        symbol: "AAPL",
        side: "buy",
        entry_time: "2026-01-01T10:00:00Z",
        entry_price: 100,
        exit_time: "2026-01-01T11:00:00Z",
        exit_price: 105,
        quantity: 1,
        position_value: 100,
        stop_loss: 98,
        take_profit: 110,
        gross_pnl: 5,
        net_pnl: 5,
        status: "closed",
        paper_or_live: "paper",
        jev_buy_probability: 0.9,
        exit_reason: "take_profit",
        created_at: "",
      },
      {
        id: "2",
        symbol: "MSFT",
        side: "buy",
        entry_time: "2026-01-01T10:00:00Z",
        entry_price: 100,
        exit_time: "2026-01-01T11:00:00Z",
        exit_price: 95,
        quantity: 1,
        position_value: 100,
        stop_loss: 95,
        take_profit: 110,
        gross_pnl: -5,
        net_pnl: -5,
        status: "closed",
        paper_or_live: "paper",
        jev_buy_probability: 0.9,
        exit_reason: "stop_loss",
        created_at: "",
      },
    ];
    expect(computeTradeStats(trades).winRate).toBe(0.5);
  });

  it("labels eod_flatten exits for analytics", () => {
    expect(exitReasonLabel("eod_flatten")).toBe("EOD flatten (incl. losers)");
  });
});
