import { describe, expect, it } from "vitest";
import {
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
