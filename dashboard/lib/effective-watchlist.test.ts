import { describe, expect, it } from "vitest";
import {
  formatPredictingWatchlistHeadline,
  formatWatchlistScanStatus,
  resolveEffectiveWatchlist,
  resolveWatchlistScanStatus,
} from "@/lib/effective-watchlist";
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
    max_open_positions: 2,
    stop_loss_percentage: 0.01,
    take_profit_percentage: 0.02,
    max_hold_minutes: 0,
    min_hold_minutes: 15,
    jev_sell_exit_threshold: 0.95,
    reentry_cooldown_minutes: 45,
    min_volume_ratio: 0,
    min_share_price: 20,
    min_dollar_volume: 250_000,
    account_capital: 1000,
    risk_sync_equity: null,
    watchlist: ["OLD"],
    watchlist_core: ["NVDA", "AAPL", "EEM"],
    watchlist_dynamic_enabled: true,
    watchlist_dynamic_size: 5,
    watchlist_min_buy: 0.6,
    watchlist_refresh_minutes: 30,
    benchmark_symbol: "EEM",
    watchlist_jev_rankings: [],
    watchlist_screener_ran_at: null,
    demotion_exits_enabled: true,
    demotion_max_hold_ratio: 0.5,
    demotion_jev_sell_on_loss: true,
    demotion_jev_sell_max_loss_pct: 0.02,
    demotion_force_exit: false,
    em_universe_synced_at: null,
    em_universe_source: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveEffectiveWatchlist", () => {
  it("uses core before first scan", () => {
    const settings = baseSettings({
      watchlist: ["BABA", "VALE"],
      watchlist_screener_ran_at: null,
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["NVDA", "AAPL"]);
  });

  it("strips stale core from a pre-dynamic-only union", () => {
    const settings = baseSettings({
      watchlist: ["NVDA", "AAPL", "BABA", "VALE", "EEM"],
      watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
      watchlist_jev_rankings: [
        { symbol: "BABA", buy: 0.9, hold: 0.05, sell: 0.05, rank: 1 },
        { symbol: "VALE", buy: 0.85, hold: 0.1, sell: 0.05, rank: 2 },
      ],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual(["BABA", "VALE"]);
  });

  it("keeps empty list after a successful weak scan", () => {
    const settings = baseSettings({
      watchlist: [],
      watchlist_screener_ran_at: "2026-01-10T15:00:00Z",
      watchlist_jev_rankings: [
        { symbol: "PDD", buy: 0.2, hold: 0.75, sell: 0.05, rank: 1 },
      ],
    });
    expect(resolveEffectiveWatchlist(settings)).toEqual([]);
  });

  it("reports scan status modes", () => {
    expect(
      resolveWatchlistScanStatus(
        baseSettings({ watchlist_dynamic_enabled: false }),
      ).mode,
    ).toBe("always_on");
    expect(
      resolveWatchlistScanStatus(
        baseSettings({ watchlist_screener_ran_at: null }),
      ).mode,
    ).toBe("waiting_first_scan");
    expect(
      resolveWatchlistScanStatus(
        baseSettings({ watchlist_screener_ran_at: "2026-01-10T15:00:00Z" }),
      ).mode,
    ).toBe("last_scan");
  });

  it("formats scan status copy", () => {
    expect(formatWatchlistScanStatus({ mode: "waiting_first_scan" })).toContain(
      "Waiting for first scan",
    );
    expect(formatWatchlistScanStatus({ mode: "last_scan", ranAt: "2026-01-10T15:00:00Z" })).toContain(
      "Using last scan",
    );
  });

  it("formats predicting headline", () => {
    expect(formatPredictingWatchlistHeadline({ mode: "waiting_first_scan" })).toContain(
      "fallback",
    );
    expect(formatPredictingWatchlistHeadline({ mode: "last_scan", ranAt: "2026-01-10T15:00:00Z" })).toContain(
      "dynamic EM",
    );
  });
});
