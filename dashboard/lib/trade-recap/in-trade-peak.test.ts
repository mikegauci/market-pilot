import { describe, expect, it } from "vitest";
import { computeInTradePeak } from "@/lib/trade-recap/in-trade-peak";

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
