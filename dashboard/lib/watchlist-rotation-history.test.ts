import { describe, expect, it } from "vitest";
import {
  activeBreakoutWindows,
  normalizeWatchlistRotationHistory,
  latestRotationChange,
  parseWatchlistRotationNote,
  prependWatchlistRotationHistory,
} from "@/lib/watchlist-rotation-history";

describe("parseWatchlistRotationNote", () => {
  it("parses legacy in/out notes", () => {
    expect(parseWatchlistRotationNote("in MU, AMAT / out AMD")).toEqual({
      added: ["MU", "AMAT"],
      removed: ["AMD"],
    });
    expect(parseWatchlistRotationNote("in MU / out -")).toEqual({
      added: ["MU"],
      removed: [],
    });
  });

  it("parses added/removed notes", () => {
    expect(parseWatchlistRotationNote("added MU · removed AMD")).toEqual({
      added: ["MU"],
      removed: ["AMD"],
    });
  });

  it("ignores no change", () => {
    expect(parseWatchlistRotationNote("no change")).toBeNull();
  });
});

describe("latestRotationChange", () => {
  it("prefers stored history", () => {
    const entry = {
      at: "2026-10-07T12:00:00.000Z",
      added: ["MU"],
      removed: ["AMD"],
    };
    expect(
      latestRotationChange([entry], "added QQQ", "2026-10-07T13:00:00.000Z"),
    ).toEqual(entry);
  });

  it("falls back to last note", () => {
    expect(
      latestRotationChange([], "in MU / out -", "2026-10-07T12:00:00.000Z"),
    ).toMatchObject({ added: ["MU"], removed: [] });
  });
});

describe("prependWatchlistRotationHistory", () => {
  it("caps length", () => {
    const existing = Array.from({ length: 30 }, (_, index) => ({
      at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      detail: "x",
    }));
    const next = prependWatchlistRotationHistory(existing, {
      at: "2026-02-01T00:00:00.000Z",
      detail: "new",
    });
    expect(next).toHaveLength(30);
    expect(next[0]?.detail).toBe("new");
  });
});

describe("breakout history", () => {
  const history = normalizeWatchlistRotationHistory([
    {
      at: "2026-10-09T13:55:00Z",
      added: ["qcom"],
      removed: ["XYZ"],
      detail: "breakout",
      breakout_until: "2026-10-09T14:05:00Z",
    },
    { at: "2026-10-09T13:50:00Z", added: ["AMD"], detail: "breakout" },
    { at: "2026-10-09T13:45:00Z", added: ["META"], removed: ["IBM"] },
  ]);

  it("flags breakout entries and keeps the window end", () => {
    expect(history[0]).toMatchObject({
      breakout: true,
      breakoutUntil: "2026-10-09T14:05:00Z",
      added: ["QCOM"],
    });
    expect(history[2]?.breakout).toBeUndefined();
  });

  it("lists symbols still inside their window, falling back to at + window minutes", () => {
    const now = Date.parse("2026-10-09T13:58:00Z");
    const windows = activeBreakoutWindows(history, now, 10);
    expect([...windows.keys()]).toEqual(["QCOM", "AMD"]);
    expect(windows.get("AMD")).toBe(Date.parse("2026-10-09T14:00:00Z"));
    expect(activeBreakoutWindows(history, Date.parse("2026-10-09T14:06:00Z"), 10).size).toBe(0);
  });
});
