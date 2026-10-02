import { describe, expect, it } from "vitest";
import { tradingDayTradesOrFilter } from "@/lib/trading-day-trades";

describe("tradingDayTradesOrFilter", () => {
  it("includes entries since day start and still-open positions", () => {
    expect(tradingDayTradesOrFilter("2026-03-02T05:00:00.000Z")).toBe(
      "entry_time.gte.2026-03-02T05:00:00.000Z,status.eq.open",
    );
  });
});
