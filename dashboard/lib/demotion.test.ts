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
    min_volume_ratio: 0,
    min_share_price: 20,
    account_capital: 1000,
    risk_sync_equity: null,
    watchlist: ["BABA", "VALE", "EEM"],
    watchlist_core: ["NVDA", "AAPL", "EEM"],
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
});
