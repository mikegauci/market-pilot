import { describe, expect, it } from "vitest";
import { normalizeSettings } from "@/lib/normalize-settings";
import type { SettingsRow } from "@/lib/normalize-settings";

describe("normalizeSettings", () => {
  it("fills demotion defaults for partial rows", () => {
    const raw = {
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
      min_volume_ratio: 0,
      account_capital: 1000,
      risk_sync_equity: null,
      watchlist: ["EEM"],
      watchlist_core: ["EEM"],
      watchlist_dynamic_enabled: true,
      watchlist_dynamic_size: 5,
      watchlist_refresh_minutes: 30,
      benchmark_symbol: "EEM",
      watchlist_jev_rankings: [],
      watchlist_screener_ran_at: null,
      em_universe_synced_at: null,
      em_universe_source: null,
      updated_at: "",
    } satisfies SettingsRow;

    const normalized = normalizeSettings(raw);
    expect(normalized?.min_share_price).toBe(20);
    expect(normalized?.min_dollar_volume).toBe(250_000);
    expect(normalized?.min_hold_minutes).toBe(15);
    expect(normalized?.jev_sell_exit_threshold).toBe(0.95);
    expect(normalized?.reentry_cooldown_minutes).toBe(45);
    expect(normalized?.demotion_exits_enabled).toBe(true);
    expect(normalized?.demotion_max_hold_ratio).toBe(0.5);
    expect(normalized?.demotion_jev_sell_on_loss).toBe(true);
    expect(normalized?.demotion_force_exit).toBe(false);
    expect(normalized?.watchlist_min_buy).toBe(0.6);
  });
});
