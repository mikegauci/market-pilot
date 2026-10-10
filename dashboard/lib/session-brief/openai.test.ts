import { describe, expect, it } from "vitest";
import { parseBriefFromModelText } from "@/lib/session-brief/parse-brief-text";

describe("parseBriefFromModelText", () => {
  it("parses structured brief JSON", () => {
    const raw = JSON.stringify({
      headline: "Test",
      what_happened: ["One line"],
      entry_blockers: [{ reason: "Spread", count: 1, takeaway: "Wide quotes" }],
      exits: ["Mostly stops"],
      suggestions: [{ setting: "Max spread", direction: "keep", why: "Fine for now" }],
      missed_opportunities_summary: [],
  what_went_wrong: [],
    });

    const parsed = parseBriefFromModelText(raw);
    expect(parsed.headline).toBe("Test");
  });
});
