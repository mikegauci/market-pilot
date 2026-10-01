import { describe, expect, it } from "vitest";
import { pnlSignFromBarProps } from "@/lib/recharts-bar-interaction";

describe("pnlSignFromBarProps", () => {
  it("uses bar value when present", () => {
    expect(pnlSignFromBarProps({ value: 12.5 })).toBe("positive");
    expect(pnlSignFromBarProps({ value: -3 })).toBe("negative");
  });

  it("falls back to payload pnl fields", () => {
    expect(pnlSignFromBarProps({ payload: { dailyPnl: -1 } })).toBe("negative");
    expect(pnlSignFromBarProps({ payload: { pnl: 2 } })).toBe("positive");
  });

  it("prefers value over payload", () => {
    expect(pnlSignFromBarProps({ value: 1, payload: { pnl: -99 } })).toBe("positive");
  });
});
