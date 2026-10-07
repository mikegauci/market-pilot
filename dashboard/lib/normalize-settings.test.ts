import { describe, expect, it } from "vitest";
import { normalizeSettings } from "@/lib/normalize-settings";
import type { SettingsRow } from "@/lib/normalize-settings";

describe("normalizeSettings", () => {
  it("fills defaults for partial rows", () => {
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
      watchlist: ["NVDA"],
      benchmark_symbol: "",
      updated_at: "",
    } satisfies SettingsRow;

    const normalized = normalizeSettings(raw);
    expect(normalized?.min_share_price).toBe(20);
    expect(normalized?.min_dollar_volume).toBe(250_000);
    expect(normalized?.min_hold_minutes).toBe(15);
    expect(normalized?.jev_sell_exit_threshold).toBe(0.95);
    expect(normalized?.reentry_cooldown_minutes).toBe(45);
    expect(normalized?.max_entries_per_symbol_per_day).toBe(3);
    expect(normalized?.rotation_min_session_change_pct).toBe(0);
    expect(normalized?.profit_take_enabled).toBe(false);
    expect(normalized?.profit_take_min_fraction).toBe(0.7);
    expect(normalized?.profit_take_max_fraction).toBe(0.8);
    expect(normalized?.loss_cut_enabled).toBe(false);
    expect(normalized?.loss_cut_min_fraction).toBe(0.7);
    expect(normalized?.loss_cut_jev_sell_threshold).toBe(0);
    expect(normalized?.confirmation_cycles).toBe(2);
    expect(normalized?.confirmation_seconds).toBe(30);
  });
});
