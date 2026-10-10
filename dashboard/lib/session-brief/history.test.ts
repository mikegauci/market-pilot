import { describe, expect, it } from "vitest";
import {
  buildSessionBriefHistory,
  defaultSelectedSessionDate,
  indexBriefsBySessionDate,
} from "@/lib/session-brief/history";
import type { SessionBriefRow } from "@/lib/types/database";

function brief(sessionDate: string, createdAt: string): SessionBriefRow {
  return {
    id: `${sessionDate}-${createdAt}`,
    session_date: sessionDate,
    model: "gpt-4o-mini",
    input: {},
    brief: {
      headline: sessionDate,
      what_happened: [],
      entry_blockers: [],
      exits: [],
      suggestions: [],
      missed_opportunities_summary: [],
  what_went_wrong: [],
    },
    created_by: "user",
    created_at: createdAt,
  };
}

describe("session brief history", () => {
  it("keeps the newest brief per session date", () => {
    const map = indexBriefsBySessionDate([
      brief("2026-10-02", "2026-10-02T20:00:00Z"),
      brief("2026-10-02", "2026-10-02T21:00:00Z"),
    ]);
    expect(map.get("2026-10-02")?.created_at).toBe("2026-10-02T21:00:00Z");
  });

  it("defaults to the oldest session when starting the timeline", () => {
    const history = buildSessionBriefHistory(
      [
        { session_date: "2026-10-03", prediction_count: 1 },
        { session_date: "2026-10-02", prediction_count: 2 },
      ],
      [],
    );
    expect(defaultSelectedSessionDate(history)).toBe("2026-10-02");
  });
});
