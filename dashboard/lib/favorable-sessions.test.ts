import { describe, expect, it } from "vitest";
import {
  buildFavorableSessionNote,
  formatSessionDate,
  lookbackDaysForRange,
  mapFavorableSessionRpcRows,
  newYorkCalendarDate,
  roundedFavorablePercent,
  type FavorableSessionRow,
} from "@/lib/favorable-sessions";

function row(
  sessionDate: string,
  favorableMinutes: number,
  sampledMinutes: number,
): FavorableSessionRow {
  return {
    sessionDate,
    favorableMinutes,
    sampledMinutes,
    favorablePct: roundedFavorablePercent(favorableMinutes, sampledMinutes),
  };
}

/** Friday 2 Oct 2026, 14:00 New York (EDT, session still open). */
const OPEN_SESSION = new Date("2026-10-02T18:00:00Z");

describe("roundedFavorablePercent", () => {
  it("rounds half up to the nearest percent", () => {
    expect(roundedFavorablePercent(5, 8)).toBe(63);
    expect(roundedFavorablePercent(1, 3)).toBe(33);
  });

  it("returns 0 when the session has no readings", () => {
    expect(roundedFavorablePercent(0, 0)).toBe(0);
  });
});

describe("lookbackDaysForRange", () => {
  it("matches the analytics ranges and caps All at the prediction window", () => {
    expect(lookbackDaysForRange("1d")).toBe(1);
    expect(lookbackDaysForRange("1w")).toBe(7);
    expect(lookbackDaysForRange("1m")).toBe(30);
    expect(lookbackDaysForRange("all")).toBe(14);
  });
});

describe("session dates", () => {
  it("formats a session date without a comma", () => {
    expect(formatSessionDate("2026-10-02")).toBe("Fri 2 Oct");
  });

  it("uses the New York calendar date while the session is open", () => {
    expect(newYorkCalendarDate(OPEN_SESSION)).toBe("2026-10-02");
    expect(newYorkCalendarDate(new Date("2026-10-03T03:30:00Z"))).toBe("2026-10-02");
  });
});

describe("mapFavorableSessionRpcRows", () => {
  it("maps numeric strings and recomputes the rounded percent", () => {
    expect(
      mapFavorableSessionRpcRows([
        {
          session_date: "2026-10-02",
          favorable_minutes: "5",
          sampled_minutes: "8",
          favorable_pct: "62.5",
        },
      ]),
    ).toEqual([row("2026-10-02", 5, 8)]);
  });

  it("returns empty for non-array input", () => {
    expect(mapFavorableSessionRpcRows(null)).toEqual([]);
  });
});

describe("buildFavorableSessionNote", () => {
  it("lists mostly favourable days newest first and marks today before the close", () => {
    const note = buildFavorableSessionNote(
      [
        row("2026-10-01", 40, 50),
        row("2026-09-30", 10, 40),
        row("2026-10-02", 31, 50),
      ],
      OPEN_SESSION,
    );

    expect(note.mostlyFavorable.map((line) => line.text)).toEqual([
      "Fri 2 Oct — 62% of the session so far",
      "Thu 1 Oct — 80% of the session",
    ]);
    expect(note.todayText).toBe("Today so far: 62% of the session was favourable.");
  });

  it("keeps today visible when the session so far is under half", () => {
    const note = buildFavorableSessionNote([row("2026-10-02", 10, 40)], OPEN_SESSION);

    expect(note.mostlyFavorable).toEqual([]);
    expect(note.todayText).toBe("Today so far: 25% of the session was favourable.");
  });

  it("includes a day that is exactly half favourable", () => {
    const note = buildFavorableSessionNote([row("2026-10-01", 20, 40)], OPEN_SESSION);

    expect(note.mostlyFavorable.map((line) => line.text)).toEqual([
      "Thu 1 Oct — 50% of the session",
    ]);
    expect(note.todayText).toBeNull();
  });
});
