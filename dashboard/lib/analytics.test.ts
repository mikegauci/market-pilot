import { describe, expect, it } from "vitest";
import { effectiveMaxHoldMinutes } from "@/lib/demotion";
import type { Settings } from "@/lib/types/database";
import {
  activityByHour,
  aggregateSkipReasons,
  buildSignalFunnel,
  findNearMisses,
  isTradeEligible,
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
  min_hold_minutes: 15,
  jev_sell_exit_threshold: 0.95,
  reentry_cooldown_minutes: 45,
  prediction_horizon_minutes: 15,
  last_entry_cutoff_minutes_before_close: 40,
  eod_closeout_enabled: true,
  eod_closeout_minutes_before_close: 10,
  eod_flat_verify_minutes_before_close: 5,
  equity_divergence_alert_frac: 0.05,
  stale_input_gates_enabled: true,
  max_quote_age_sec: 5,
  kill_stale_quote_sec: 15,
  kill_stale_quote_share_frac: 0.5,
  quote_age_log_only_sec: 300,
  max_signal_age_sec: 30,
  max_bar_gap_sec: 90,
  max_news_pub_age_sec: 3600,
  max_news_receipt_lag_sec: 600,
  pre_submit_recheck_enabled: true,
  max_entry_price_drift_frac: 0.002,
  confirmation_mode: "distinct_bars",
  confirmation_count: 2,
  kill_recover_healthy_sec: 120,
  kill_alert_min_gap_sec: 60,
  jev_transport_fail_rate_kill_frac: 0.5,
  jev_transport_fail_window_sec: 60,
  jev_timeout_sec: 3,
  jev_max_retries: 1,
  min_volume_ratio: 0,
  min_share_price: 20,
  account_capital: 10000,
  risk_sync_equity: null,
  watchlist: ["AAPL"],
  watchlist_core: ["AAPL"],
  watchlist_dynamic_enabled: true,
    watchlist_dynamic_size: 5,
    watchlist_min_buy: 0.6,
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
  const pred = (
    overrides: Partial<Prediction> & Pick<Prediction, "id" | "symbol" | "timestamp">,
  ): Prediction => ({
    price: 100,
    buy_probability: 0.9,
    hold_probability: 0.05,
    sell_probability: 0.05,
    trade_created: false,
    trade_skip_reason: null,
    created_at: "",
    ...overrides,
  });

  it("finds near misses and aggregates skip reasons", () => {
    const predictions: Prediction[] = [
      pred({
        id: "1",
        symbol: "AAPL",
        timestamp: "2026-01-01T10:00:00Z",
        buy_probability: 0.8,
        hold_probability: 0.1,
        sell_probability: 0.1,
        trade_skip_reason: "below_trade_threshold",
      }),
      pred({
        id: "2",
        symbol: "MSFT",
        timestamp: "2026-01-01T10:00:00Z",
        trade_created: true,
      }),
      pred({
        id: "3",
        symbol: "GOOG",
        timestamp: "2026-01-01T14:00:00Z",
        buy_probability: 0.88,
        hold_probability: 0.05,
        sell_probability: 0.07,
        trade_skip_reason: "awaiting_confirmation (1/3)",
      }),
    ];
    const nearMisses = findNearMisses(predictions, 0.75, 0.85);
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0]?.symbol).toBe("AAPL");
    const buckets = aggregateSkipReasons(predictions);
    expect(buckets.some((b) => b.key === "awaiting_confirmation")).toBe(true);

    const funnel = buildSignalFunnel(predictions, 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(3);
    expect(funnel.tradeEligible).toBe(2);
    expect(funnel.pastConfirmation).toBe(1);
    expect(funnel.pastFilters).toBe(1);
    expect(funnel.pastRisk).toBe(1);
    expect(funnel.traded).toBe(1);
    // Sequential: later stages never exceed earlier ones
    expect(funnel.tradeEligible).toBeLessThanOrEqual(funnel.highBuySignals);
    expect(funnel.pastConfirmation).toBeLessThanOrEqual(funnel.tradeEligible);
    expect(funnel.pastFilters).toBeLessThanOrEqual(funnel.pastConfirmation);
    expect(funnel.pastRisk).toBeLessThanOrEqual(funnel.pastFilters);
    expect(funnel.traded).toBeLessThanOrEqual(funnel.pastRisk);

    const hourly = activityByHour(predictions, 0.75, 0.85);
    expect(hourly).toHaveLength(24);
    expect(hourly[10]?.highBuy).toBe(2);
    expect(hourly[10]?.traded).toBe(1);
    expect(hourly[10]?.tradeEligible).toBe(1);
    expect(hourly[14]?.highBuy).toBe(1);
    expect(hourly[14]?.tradeEligible).toBe(1);
    expect(hourly[14]?.traded).toBe(0);
  });

  it("requires trader default BUY–HOLD margin of 0.15", () => {
    const narrowMargin = pred({
      id: "m1",
      symbol: "NVDA",
      timestamp: "2026-01-01T12:00:00Z",
      buy_probability: 0.9,
      hold_probability: 0.8, // margin 0.10 — passes 0.05, fails 0.15
      sell_probability: 0.05,
    });
    expect(isTradeEligible(narrowMargin, 0.85, 0.05)).toBe(true);
    expect(isTradeEligible(narrowMargin, 0.85)).toBe(false);

    const funnel = buildSignalFunnel([narrowMargin], 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(1);
    expect(funnel.tradeEligible).toBe(0);
  });

  it("does not count RECORD signals as past filters", () => {
    const recordOnly = pred({
      id: "r1",
      symbol: "META",
      timestamp: "2026-01-01T11:00:00Z",
      buy_probability: 0.8,
      hold_probability: 0.1,
      sell_probability: 0.1,
      trade_skip_reason: "below_trade_threshold",
    });
    const funnel = buildSignalFunnel([recordOnly], 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(1);
    expect(funnel.tradeEligible).toBe(0);
    expect(funnel.pastConfirmation).toBe(0);
    expect(funnel.pastFilters).toBe(0);
    expect(funnel.pastRisk).toBe(0);
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
