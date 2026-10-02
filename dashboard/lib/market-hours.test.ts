import { describe, expect, it } from "vitest";
import { tradingCalendarDate, tradingDayStartUtc } from "@/lib/market-hours";

describe("trading day boundaries", () => {
  it("uses US Eastern calendar date", () => {
    // 2026-03-02 03:00 UTC = 2026-03-01 22:00 ET (still prior calendar day)
    const lateEveningUtc = new Date("2026-03-02T03:00:00.000Z");
    expect(tradingCalendarDate(lateEveningUtc)).toBe("2026-03-01");

    // 2026-03-02 05:00 UTC = 2026-03-02 00:00 ET
    const midnightEtUtc = new Date("2026-03-02T05:00:00.000Z");
    expect(tradingCalendarDate(midnightEtUtc)).toBe("2026-03-02");
  });

  it("returns midnight ET as UTC ISO", () => {
    const when = new Date("2026-03-02T15:30:00.000Z");
    expect(tradingDayStartUtc(when)).toBe("2026-03-02T05:00:00.000Z");
  });
});
