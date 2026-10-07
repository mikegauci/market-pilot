import { describe, expect, it } from "vitest";
import {
  computeInTradePeak,
  computeLossCutPathStats,
  computeProfitTakePathStats,
} from "@/lib/trade-recap/in-trade-peak";

describe("computeInTradePeak", () => {
  const trade = {
    side: "buy" as const,
    entry_price: 380.87,
    take_profit: 382.65,
    quantity: 13,
  };

  it("returns null when price never exceeded entry", () => {
    expect(
      computeInTradePeak(trade, [
        { price: 380.5, created_at: "2026-10-06T15:43:00Z" },
        { price: 379.9, created_at: "2026-10-06T15:44:00Z" },
      ]),
    ).toBeNull();
  });

  it("computes peak toward take profit for a losing trade that was briefly green", () => {
    const peak = computeInTradePeak(trade, [
      { price: 381.47, created_at: "2026-10-06T17:14:26Z" },
      { price: 381.2, created_at: "2026-10-06T17:15:00Z" },
    ]);
    expect(peak).not.toBeNull();
    expect(peak!.peak_price).toBe(381.47);
    expect(peak!.peak_pct_from_entry).toBe(0.2);
    expect(peak!.peak_pct_of_take_profit_path).toBe(33.7);
    expect(peak!.peak_unrealized_dollars).toBe(7.8);
  });
});

describe("computeProfitTakePathStats", () => {
  const trade = {
    side: "buy" as const,
    entry_price: 380.87,
    take_profit: 382.65,
  };
  const settings = {
    profit_take_enabled: true,
    profit_take_min_fraction: 0.7,
    profit_take_max_fraction: 0.8,
    profit_take_min_band_hits: 3,
  };

  it("reports max path progress below the early exit band", () => {
    const stats = computeProfitTakePathStats(
      trade,
      [{ price: 381.47, created_at: "2026-10-06T17:14:26Z" }],
      settings,
    );
    expect(stats).not.toBeNull();
    expect(stats!.max_path_progress_pct).toBe(33.7);
    expect(stats!.never_reached_profit_on_path).toBe(false);
    expect(stats!.reached_early_exit_min).toBe(false);
    expect(stats!.entered_early_exit_band).toBe(false);
    expect(stats!.early_exit_band_path_pct).toEqual({ min: 70, max: 80 });
  });

  it("detects band entry when price reaches the soft exit zone", () => {
    const stats = computeProfitTakePathStats(
      trade,
      [{ price: 382.14, created_at: "2026-10-06T17:14:26Z" }],
      settings,
    );
    expect(stats!.max_path_progress_pct).toBe(71.3);
    expect(stats!.reached_early_exit_min).toBe(true);
    expect(stats!.entered_early_exit_band).toBe(true);
    expect(stats!.band_touch_cycles).toBe(1);
    expect(stats!.never_reached_profit_on_path).toBe(false);
  });

  it("marks never_reached_profit when price stayed at or below entry", () => {
    const stats = computeProfitTakePathStats(
      trade,
      [
        { price: 333.75, created_at: "2026-10-06T15:54:00Z" },
        { price: 332.6, created_at: "2026-10-06T16:40:00Z" },
      ],
      settings,
    );
    expect(stats!.never_reached_profit_on_path).toBe(true);
    expect(stats!.max_path_progress_pct).toBeNull();
    expect(stats!.reached_early_exit_min).toBe(false);
  });
});

describe("computeLossCutPathStats", () => {
  const trade = {
    side: "buy" as const,
    entry_price: 198.6,
    stop_loss: 197.92,
  };
  const settings = {
    loss_cut_enabled: true,
    loss_cut_min_fraction: 0.7,
    loss_cut_max_fraction: 0.9,
    loss_cut_min_band_hits: 3,
  };

  it("reports no stop path when price never went below entry", () => {
    const stats = computeLossCutPathStats(
      trade,
      [{ price: 199.05, created_at: "2026-10-06T17:49:00Z" }],
      settings,
    );
    expect(stats!.never_went_underwater_on_stop_path).toBe(true);
    expect(stats!.max_stop_path_progress_pct).toBeNull();
  });

  it("reports max stop path progress when underwater", () => {
    const stats = computeLossCutPathStats(
      trade,
      [
        { price: 198.2, created_at: "2026-10-06T17:45:00Z" },
        { price: 199.05, created_at: "2026-10-06T17:49:00Z" },
      ],
      settings,
    );
    expect(stats!.never_went_underwater_on_stop_path).toBe(false);
    expect(stats!.max_stop_path_progress_pct).toBe(58.8);
    expect(stats!.early_loss_cut_band_path_pct).toEqual({ min: 70, max: 90 });
  });
});
