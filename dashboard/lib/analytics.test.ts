import { describe, expect, it } from "vitest";
import {
  buildDailyEquitySeries,
  buildDailyPnlSeries,
  equityChartDomain,
} from "@/lib/portfolio-analytics";
import {
  computeTradeStats,
  exitReasonBreakdown,
  exitReasonLabel,
  filterTradesByRange,
} from "@/lib/trade-analytics";
import type { PortfolioSnapshot, Trade } from "@/lib/types/database";

describe("portfolio-analytics", () => {
  it("uses last snapshot daily_pnl per calendar day", () => {
    const history: PortfolioSnapshot[] = [
      {
        id: "1",
        timestamp: "2026-01-01T10:00:00Z",
        balance: 0,
        equity: 100,
        daily_pnl: 5,
        total_pnl: 5,
        currency: "USD",
        ibkr_account_id: null,
        created_at: "",
      },
      {
        id: "2",
        timestamp: "2026-01-01T15:00:00Z",
        balance: 0,
        equity: 110,
        daily_pnl: 10,
        total_pnl: 10,
        currency: "USD",
        ibkr_account_id: null,
        created_at: "",
      },
      {
        id: "3",
        timestamp: "2026-01-02T10:00:00Z",
        balance: 0,
        equity: 105,
        daily_pnl: -5,
        total_pnl: 5,
        currency: "USD",
        ibkr_account_id: null,
        created_at: "",
      },
    ];
    expect(buildDailyPnlSeries(history)).toEqual([
      { date: "2026-01-01", dailyPnl: 10 },
      { date: "2026-01-02", dailyPnl: -5 },
    ]);
    expect(buildDailyEquitySeries(history)).toEqual([
      { date: "2026-01-01", equity: 110, changeFromPriorDay: null },
      { date: "2026-01-02", equity: 105, changeFromPriorDay: -5 },
    ]);
  });

  it("zooms equity chart domain around data instead of zero", () => {
    const [low, high] = equityChartDomain([1_000_000, 1_000_500]);
    expect(low).toBeGreaterThan(990_000);
    expect(high).toBeLessThan(1_010_000);
    expect(low).toBeLessThan(1_000_000);
    expect(high).toBeGreaterThan(1_000_500);
  });
});

describe("trade-analytics", () => {
  const closedWin: Trade = {
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
  };

  const closedLoss: Trade = {
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
  };

  it("computes win rate from closed trades", () => {
    expect(computeTradeStats([closedWin, closedLoss]).winRate).toBe(0.5);
  });

  it("computes expectancy from win rate and avg win/loss", () => {
    const stats = computeTradeStats([closedWin, closedLoss]);
    expect(stats.expectancy).toBeCloseTo(0);
  });

  it("labels eod_flatten exits for analytics", () => {
    expect(exitReasonLabel("eod_flatten")).toBe("EOD flatten (incl. losers)");
  });

  it("sums pnl by exit reason", () => {
    const breakdown = exitReasonBreakdown([closedWin, closedLoss]);
    expect(breakdown.find((r) => r.reason === "take_profit")?.pnl).toBe(5);
    expect(breakdown.find((r) => r.reason === "stop_loss")?.pnl).toBe(-5);
  });

  it("filters closed trades by exit_time in range", () => {
    const now = Date.now();
    const recent: Trade = {
      ...closedWin,
      id: "1",
      exit_time: new Date(now - 60_000).toISOString(),
    };
    const old: Trade = {
      ...closedWin,
      id: "3",
      exit_time: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const filtered = filterTradesByRange([recent, old], "1w");
    expect(filtered.map((t) => t.id)).toEqual(["1"]);
  });
});
