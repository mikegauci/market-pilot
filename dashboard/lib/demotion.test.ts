import { describe, expect, it } from "vitest";
import { isDemotedSymbol, isOffEffectiveWatchlist } from "@/lib/demotion";
import type { Settings } from "@/lib/types/database";

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 1,
    trading_mode: "paper",
    minimum_jev_confidence: 0.8,
    signal_record_threshold: 0.5,
    risk_per_trade: 1,
    max_position_size: 100,
    max_daily_loss: 10,
    max_open_positions: 5,
    stop_loss_percentage: 0.01,
    take_profit_percentage: 0.02,
    max_hold_minutes: 0,
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
    confirmation_mode: "distinct_bars" as const,
    confirmation_count: 2,
    kill_recover_healthy_sec: 120,
    kill_alert_min_gap_sec: 60,
    jev_transport_fail_rate_kill_frac: 0.5,
    jev_transport_fail_window_sec: 60,
    jev_timeout_sec: 3,
    jev_max_retries: 1,
    reconcile_interval_sec: 60,
    reconcile_protect_orphans: true,
    daily_loss_include_unrealized: true,
    daily_loss_include_fees: false,
    daily_loss_action: "block_entries" as const,
    drawdown_breaker_enabled: false,
    drawdown_max_frac: 0.1,
    min_volume_ratio: 0,
    min_share_price: 20,
    account_capital: 1000,
    risk_sync_equity: null,
    watchlist: ["BABA", "VALE", "EEM"],
    watchlist_core: ["NVDA", "AAPL", "EEM"],
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
    ...overrides,
  };
}

describe("demotion", () => {
  it("flags symbols off the effective watchlist", () => {
    expect(isOffEffectiveWatchlist("NU", baseSettings())).toBe(true);
    expect(isOffEffectiveWatchlist("BABA", baseSettings())).toBe(false);
    expect(isOffEffectiveWatchlist("EEM", baseSettings())).toBe(false);
  });

  it("respects demotion_exits_enabled", () => {
    expect(isDemotedSymbol("NU", baseSettings({ demotion_exits_enabled: false }))).toBe(
      false,
    );
    expect(isDemotedSymbol("NU", baseSettings())).toBe(true);
  });

  it("shows off-watchlist badge even when demotion exits are disabled", () => {
    expect(
      isOffEffectiveWatchlist("NU", baseSettings({ demotion_exits_enabled: false })),
    ).toBe(true);
  });

  it("does not demote when dynamic watchlist is empty after a scan", () => {
    const settings = baseSettings({ watchlist: [] });
    expect(isOffEffectiveWatchlist("NU", settings)).toBe(false);
    expect(isDemotedSymbol("NU", settings)).toBe(false);
  });
});
