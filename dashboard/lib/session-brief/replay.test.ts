import { describe, expect, it } from "vitest";
import { bucketTimeOfDay, replaySkip, tradePath } from "@/lib/session-brief/replay";

const close = new Date("2026-10-09T20:00:00Z");
const base = {
  entryTs: "2026-10-09T14:00:00Z",
  entryPrice: 100,
  stopPct: 0.01,
  takePct: 0.02,
  maxHoldMinutes: 60,
  sessionClose: close,
};
const bar = (ts: string, high: number, low: number, c = 100) => ({ ts, high, low, close: c });

describe("replaySkip", () => {
  it("hits take profit", () => {
    const r = replaySkip({
      ...base,
      bars: [bar("2026-10-09T14:05:00Z", 100.5, 99.8), bar("2026-10-09T14:10:00Z", 102.1, 100)],
    });
    expect(r.outcome).toBe("take_profit");
    expect(r.move_pct).toBe(2);
    expect(r.max_up_pct).toBe(2.1);
  });

  it("hits stop loss", () => {
    const r = replaySkip({ ...base, bars: [bar("2026-10-09T14:05:00Z", 100.2, 98.9)] });
    expect(r.outcome).toBe("stop_loss");
    expect(r.move_pct).toBe(-1);
  });

  it("counts a bar touching both levels as the stop", () => {
    const r = replaySkip({ ...base, bars: [bar("2026-10-09T14:05:00Z", 103, 98)] });
    expect(r.outcome).toBe("stop_loss");
  });

  it("times out at the last close inside the hold window", () => {
    const r = replaySkip({
      ...base,
      bars: [
        bar("2026-10-09T14:05:00Z", 100.5, 99.5, 100.4),
        bar("2026-10-09T15:30:00Z", 110, 90, 110),
      ],
    });
    expect(r.outcome).toBe("timed_out");
    expect(r.move_pct).toBe(0.4);
  });

  it("flattens before the close", () => {
    const r = replaySkip({
      ...base,
      entryTs: "2026-10-09T19:30:00Z",
      maxHoldMinutes: 120,
      bars: [bar("2026-10-09T19:35:00Z", 100.2, 99.9, 100.1), bar("2026-10-09T19:55:00Z", 120, 100)],
    });
    expect(r.outcome).toBe("timed_out");
    expect(r.move_pct).toBe(0.1);
  });

  it("treats max hold 0 as no time limit", () => {
    const r = replaySkip({
      ...base,
      maxHoldMinutes: 0,
      bars: [bar("2026-10-09T14:05:00Z", 100.5, 99.8), bar("2026-10-09T18:00:00Z", 102.1, 100)],
    });
    expect(r.outcome).toBe("take_profit");
  });

  it("ignores a bar that crosses the hold deadline", () => {
    const r = replaySkip({
      ...base,
      entryTs: "2026-10-09T14:02:00Z",
      bars: [bar("2026-10-09T14:05:00Z", 100.1, 99.9, 100), bar("2026-10-09T15:00:00Z", 103, 100)],
    });
    expect(r.outcome).toBe("timed_out");
  });

  it("returns no_data without bars", () => {
    expect(replaySkip({ ...base, bars: [] }).outcome).toBe("no_data");
  });
});

describe("tradePath", () => {
  it("reports best and worst excursion", () => {
    const r = tradePath({
      entryTs: "2026-10-09T14:02:00Z",
      exitTs: "2026-10-09T14:20:00Z",
      entryPrice: 100,
      bars: [
        bar("2026-10-09T14:00:00Z", 101, 99.5),
        bar("2026-10-09T14:10:00Z", 102, 98.5),
        bar("2026-10-09T14:25:00Z", 150, 50),
      ],
    });
    expect(r).toEqual({ max_up_pct: 2, max_down_pct: -1.5 });
  });
});

describe("bucketTimeOfDay", () => {
  it("buckets by ET minutes", () => {
    expect(bucketTimeOfDay(9 * 60 + 45)).toBe("open");
    expect(bucketTimeOfDay(12 * 60)).toBe("midday");
    expect(bucketTimeOfDay(15 * 60 + 20)).toBe("power_hour");
  });
});
