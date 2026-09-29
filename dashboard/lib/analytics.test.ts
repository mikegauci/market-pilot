import { describe, expect, it } from "vitest";
import { effectiveMaxHoldMinutes } from "@/lib/demotion";
import type { Settings } from "@/lib/types/database";
import {
  aggregateSkipReasons,
  buildSignalFunnel,
  findNearMisses,
} from "@/lib/skip-reason-stats";
import { computeTradeStats, exitReasonLabel } from "@/lib/trade-analytics";
import { buildEquitySeries, maxDrawdownPct } from "@/lib/portfolio-analytics";
import type { PortfolioSnapshot, Prediction, Trade } from "@/lib/types/database";

const baseSettings: Settings = {
  id: 1,
  trading_mode: "paper",
  minimum_jev_confidence: 0.85,
  signal_record_threshold: 0.75,
  risk_per_trade: 0.01,
  max_position_size: 1000,
  max_daily_loss: 500,
  max_open_positions: 3,
  stop_loss_percentage: 0.02,
  take_profit_percentage: 0.04,
  max_hold_minutes: 100,
  min_volume_ratio: 0,
  account_capital: 10000,
  risk_sync_equity: null,
  watchlist: ["AAPL"],
  watchlist_core: ["AAPL"],
  watchlist_dynamic_enabled: true,
  watchlist_dynamic_size: 5,
  watchlist_refresh_minutes: 30,
  benchmark_symbol: "EEM",
  watchlist_jev_rankings: [],
  watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
  demotion_exits_enabled: true,
  demotion_max_hold_ratio: 0.5,
  demotion_jev_sell_on_loss: true,
  demotion_jev_sell_max_loss_pct: 0.02,
  demotion_force_exit: false,
  em_universe_synced_at: null,
  em_universe_source: null,
  updated_at: "",
};

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
  it("computes win rate and exit labels", () => {
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
    const stats = computeTradeStats(trades);
    expect(stats.winRate).toBe(0.5);
    expect(exitReasonLabel("take_profit")).toBe("Take profit");
  });
});

describe("skip-reason-stats", () => {
  it("finds near misses and aggregates skip reasons", () => {
    const predictions: Prediction[] = [
      {
        id: "1",
        symbol: "AAPL",
        timestamp: "2026-01-01T10:00:00Z",
        price: 100,
        buy_probability: 0.8,
        hold_probability: 0.1,
        sell_probability: 0.1,
        trade_created: false,
        trade_skip_reason: "below_trade_threshold",
        created_at: "",
      },
      {
        id: "2",
        symbol: "MSFT",
        timestamp: "2026-01-01T10:00:00Z",
        price: 100,
        buy_probability: 0.9,
        hold_probability: 0.05,
        sell_probability: 0.05,
        trade_created: false,
        trade_skip_reason: "spread_too_wide (0.20%)",
        created_at: "",
      },
    ];
    const nearMisses = findNearMisses(predictions, 0.75, 0.85);
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0]?.symbol).toBe("AAPL");
    const buckets = aggregateSkipReasons(predictions);
    expect(buckets.some((b) => b.key === "spread_too_wide")).toBe(true);
    const funnel = buildSignalFunnel(predictions, 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(2);
  });
});

describe("demotion effectiveMaxHoldMinutes", () => {
  it("halves hold time for demoted symbols", () => {
    const settings = {
      ...baseSettings,
      watchlist: ["BABA"],
      watchlist_jev_rankings: [{ symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 }],
    };
    expect(effectiveMaxHoldMinutes("NU", settings)).toBe(50);
    expect(effectiveMaxHoldMinutes("BABA", settings)).toBe(100);
  });
});
