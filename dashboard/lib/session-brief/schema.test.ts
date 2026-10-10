import { describe, expect, it } from "vitest";
import { parseSessionBrief } from "@/lib/session-brief/schema";

const valid = {
  headline: "Quiet session with spread blocks",
  what_happened: ["The bot logged many eligible BUY signals."],
  entry_blockers: [
    { reason: "Spread too wide", count: 12, takeaway: "Quotes were often wider than your max." },
  ],
  exits: ["Most closes were take-profit."],
  suggestions: [
    { setting: "Max spread", direction: "raise", why: "Spread skips dominated near-misses." },
  ],
  missed_opportunities_summary: [],
  what_went_wrong: [],
};

describe("parseSessionBrief", () => {
  it("accepts a well-formed brief", () => {
    expect(parseSessionBrief(valid).headline).toBe(valid.headline);
  });

  it("defaults the replay sections for briefs saved before they existed", () => {
    const { missed_opportunities_summary, what_went_wrong, ...old } = valid;
    void missed_opportunities_summary;
    void what_went_wrong;
    const parsed = parseSessionBrief({ ...old, caveats: ["Paper only"] });
    expect(parsed.missed_opportunities_summary).toEqual([]);
    expect(parsed.what_went_wrong).toEqual([]);
    expect(parsed.suggestions[0]?.evidence).toBe("");
  });

  it("rejects malformed suggestions", () => {
    expect(() =>
      parseSessionBrief({
        ...valid,
        suggestions: [{ setting: "x", direction: "up", why: "y" }],
      }),
    ).toThrow(/suggestions/i);
  });
});
