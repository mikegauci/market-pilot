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
  exitReasonFilterOptions,
  exitReasonSortLabel,
  filterTradesByExitReason,
  filterTradesByRange,
  normalizeExitReasonKey,
  tradesEmptyMessage,
  tradesFiltersConflict,
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
        ibkr_accrued_cash: null,
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
        ibkr_accrued_cash: null,
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
        ibkr_accrued_cash: null,
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

  it("labels eod_flatten exits for analytics", () => {
    expect(exitReasonLabel("eod_flatten")).toBe("EOD flatten (incl. losers)");
  });

  it("sums pnl by exit reason", () => {
    const breakdown = exitReasonBreakdown([closedWin, closedLoss]);
    expect(breakdown.find((r) => r.reason === "take_profit")?.pnl).toBe(5);
    expect(breakdown.find((r) => r.reason === "stop_loss")?.pnl).toBe(-5);
  });

  it("groups ibkr exit reasons in breakdown", () => {
    const ibkrSl: Trade = {
      ...closedLoss,
      id: "ibkr-sl",
      exit_reason: "ibkr_stop",
      net_pnl: -2,
    };
    const ibkrTp: Trade = {
      ...closedWin,
      id: "ibkr-tp",
      exit_reason: "ibkr_take_profit",
      net_pnl: 3,
    };
    const breakdown = exitReasonBreakdown([ibkrSl, ibkrTp]);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.reason).toBe("ibkr");
    expect(breakdown[0]?.pnl).toBe(1);
  });

  const openTrade: Trade = {
    ...closedWin,
    id: "open",
    status: "open",
    exit_time: null,
    exit_price: null,
    net_pnl: null,
    exit_reason: null,
  };

  it("normalizes exit reason keys for filters", () => {
    expect(normalizeExitReasonKey(openTrade)).toBe("open");
    expect(normalizeExitReasonKey(closedLoss)).toBe("stop_loss");
    expect(
      normalizeExitReasonKey({ ...closedWin, exit_reason: "ibkr_stop" }),
    ).toBe("ibkr");
    expect(normalizeExitReasonKey({ ...closedWin, exit_reason: null })).toBe("unknown");
  });

  it("filters trades by exit reason", () => {
    const ibkrClosed: Trade = {
      ...closedWin,
      id: "ibkr",
      exit_reason: "ibkr_take_profit",
    };
    const all = [openTrade, closedWin, closedLoss, ibkrClosed];
    expect(filterTradesByExitReason(all, "all")).toHaveLength(4);
    expect(filterTradesByExitReason(all, "open").map((t) => t.id)).toEqual(["open"]);
    expect(filterTradesByExitReason(all, "stop_loss").map((t) => t.id)).toEqual(["2"]);
    expect(filterTradesByExitReason(all, "ibkr").map((t) => t.id)).toEqual(["ibkr"]);
  });

  it("only lists exit filters present in the trade list", () => {
    const values = exitReasonFilterOptions([closedLoss]).map((o) => o.value);
    expect(values).toEqual(["all", "stop_loss"]);
    expect(values).not.toContain("take_profit");
  });

  it("adds custom exit reasons to filter options from trades", () => {
    const legacy: Trade = {
      ...closedWin,
      id: "legacy",
      exit_reason: "legacy_exit",
    };
    const values = exitReasonFilterOptions([legacy]).map((o) => o.value);
    expect(values).toContain("legacy_exit");
    expect(values).not.toContain("stop_loss");
  });

  it("labels exit reasons for sort", () => {
    expect(exitReasonSortLabel(closedLoss)).toBe("Stop loss");
  });

  it("detects conflicting table filters", () => {
    expect(tradesFiltersConflict("open", "stop_loss")).toBe(true);
    expect(tradesFiltersConflict("closed", "open")).toBe(true);
    expect(tradesFiltersConflict("all", "stop_loss")).toBe(false);
    expect(
      tradesEmptyMessage(true, "open", "stop_loss"),
    ).toMatch(/Reset the status or exit reason filter/);
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
