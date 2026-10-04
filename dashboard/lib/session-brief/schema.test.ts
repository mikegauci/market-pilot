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
  caveats: ["Paper trading only; one day of data."],
};

describe("parseSessionBrief", () => {
  it("accepts a well-formed brief", () => {
    expect(parseSessionBrief(valid).headline).toBe(valid.headline);
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
