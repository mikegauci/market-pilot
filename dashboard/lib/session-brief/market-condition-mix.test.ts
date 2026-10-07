import { describe, expect, it } from "vitest";
import {
  formatConditionShareLine,
  parseSessionConditionMix,
  sessionConditionCoverageNote,
  sharesFromMinutes,
} from "@/lib/session-brief/market-condition-mix";

describe("sharesFromMinutes", () => {
  it("rounds the 2 Oct watchlist mix to whole percents that add to 100", () => {
    const shares = sharesFromMinutes({
      favorable_minutes: 203,
      caution_minutes: 162,
      headwind_minutes: 25,
      unknown_minutes: 0,
    });
    expect(formatConditionShareLine(shares)).toBe("52% Favorable, 42% Caution, 6% Headwind");
    const total = shares.reduce((sum, share) => sum + (share.percent ?? 0), 0);
    expect(total).toBe(100);
  });

  it("shows a sliver as under 1 percent", () => {
    const shares = sharesFromMinutes({
      favorable_minutes: 389,
      caution_minutes: 0,
      headwind_minutes: 1,
      unknown_minutes: 0,
    });
    expect(formatConditionShareLine(shares)).toBe("100% Favorable, <1% Headwind");
  });
});

describe("parseSessionConditionMix", () => {
  it("ignores invalid rows", () => {
    expect(parseSessionConditionMix([null, { session_date: "" }, "bad"])).toEqual([]);
  });

  it("keeps the date and minute counts", () => {
    const rows = parseSessionConditionMix([
      {
        session_date: "2026-10-02",
        favorable_minutes: 203,
        caution_minutes: "162",
        headwind_minutes: 25,
        unknown_minutes: 0,
        observed_minutes: 390,
      },
    ]);
    expect(rows).toEqual([
      {
        session_date: "2026-10-02",
        favorable_minutes: 203,
        caution_minutes: 162,
        headwind_minutes: 25,
        unknown_minutes: 0,
        observed_minutes: 390,
      },
    ]);
  });
});

describe("sessionConditionCoverageNote", () => {
  it("names a full session without a shortfall", () => {
    expect(sessionConditionCoverageNote(390)).toMatch(/all 390 minutes/);
    expect(sessionConditionCoverageNote(390)).toMatch(/symbols the bot evaluated/i);
  });

  it("names a short session against a full day", () => {
    expect(sessionConditionCoverageNote(358)).toMatch(/358 recorded minutes/);
    expect(sessionConditionCoverageNote(358)).toMatch(/full session is 390/);
  });
});
