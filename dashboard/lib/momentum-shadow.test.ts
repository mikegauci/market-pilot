import { describe, expect, it } from "vitest";
import {
  matchTradeMomentumShadow,
  parseMomentumShadowVerdict,
  summarizeMomentumShadow,
  type MomentumShadowPredictionRow,
} from "@/lib/momentum-shadow";

const row = (
  symbol: string,
  timestamp: string,
  verdict: string | null,
): MomentumShadowPredictionRow => ({
  symbol,
  timestamp,
  momentum_shadow_verdict: verdict,
  momentum_shadow_note: verdict ? `${verdict} note` : null,
});

describe("matchTradeMomentumShadow", () => {
  it("picks the nearest entry prediction for the same symbol", () => {
    const trades = [{ id: "t1", symbol: "PLTR", entry_time: "2026-10-09T15:16:17.972Z" }];
    const rows = [
      row("PLTR", "2026-10-09T15:15:48.608Z", "would_block"),
      row("PLTR", "2026-10-09T15:16:17.969Z", "would_keep"),
      row("GOOGL", "2026-10-09T15:16:17.969Z", "would_block"),
    ];
    const map = matchTradeMomentumShadow(trades, rows);
    expect(map.get("t1")).toEqual({ verdict: "would_keep", note: "would_keep note" });
  });

  it("skips trades with no prediction in the window or no verdict", () => {
    const trades = [
      { id: "far", symbol: "PLTR", entry_time: "2026-10-09T15:20:00Z" },
      { id: "old", symbol: "AAPL", entry_time: "2026-10-09T15:00:00Z" },
    ];
    const rows = [
      row("PLTR", "2026-10-09T15:16:00Z", "would_keep"),
      row("AAPL", "2026-10-09T15:00:00Z", null),
    ];
    expect(matchTradeMomentumShadow(trades, rows).size).toBe(0);
  });
});

describe("summarizeMomentumShadow", () => {
  it("splits closed trades by verdict and ignores open trades", () => {
    const verdicts = new Map([
      ["a", { verdict: "would_keep" as const, note: null }],
      ["b", { verdict: "would_block" as const, note: null }],
      ["c", { verdict: "would_block" as const, note: null }],
      ["d", { verdict: "would_keep" as const, note: null }],
    ]);
    const summary = summarizeMomentumShadow(
      [
        { id: "a", status: "closed", net_pnl: 20.48 },
        { id: "b", status: "closed", net_pnl: -26.97 },
        { id: "c", status: "closed", net_pnl: 21.66 },
        { id: "d", status: "open", net_pnl: null },
      ],
      verdicts,
    );
    expect(summary?.keep).toEqual({ count: 1, wins: 1, netPnl: 20.48 });
    expect(summary?.block.count).toBe(2);
    expect(summary?.block.wins).toBe(1);
    expect(summary?.block.netPnl).toBeCloseTo(-5.31);
  });

  it("returns null when no closed trade has a verdict", () => {
    expect(summarizeMomentumShadow([{ id: "x", status: "closed", net_pnl: 5 }], new Map())).toBeNull();
  });
});

describe("parseMomentumShadowVerdict", () => {
  it("accepts only known verdicts", () => {
    expect(parseMomentumShadowVerdict("would_keep")).toBe("would_keep");
    expect(parseMomentumShadowVerdict("agree")).toBeNull();
    expect(parseMomentumShadowVerdict(null)).toBeNull();
  });
});
