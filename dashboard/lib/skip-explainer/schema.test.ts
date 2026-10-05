import { describe, expect, it } from "vitest";
import { parseSkipExplanationText } from "@/lib/skip-explainer/schema";

describe("parseSkipExplanationText", () => {
  it("parses a structured explanation", () => {
    const parsed = parseSkipExplanationText(
      JSON.stringify({
        summary: "Jev wanted BABA, but the quote was wide.",
        closeness: "hard_block",
        what_blocked_it: "The spread was wider than the bot allows.",
      }),
    );

    expect(parsed.closeness).toBe("hard_block");
    expect(parsed.summary).toContain("BABA");
  });

  it("rejects an unknown closeness", () => {
    expect(() =>
      parseSkipExplanationText(
        JSON.stringify({
          summary: "Something",
          closeness: "maybe",
          what_blocked_it: "A gate.",
        }),
      ),
    ).toThrow(/closeness/);
  });
});
