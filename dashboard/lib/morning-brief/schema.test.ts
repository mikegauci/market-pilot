import { describe, expect, it } from "vitest";
import { constrainMorningBrief, parseMorningBriefText } from "@/lib/morning-brief/schema";

describe("parseMorningBriefText", () => {
  it("parses a morning brief", () => {
    const parsed = parseMorningBriefText(
      JSON.stringify({
        headline: "Quiet tape, one lawsuit on the list",
        names_to_watch: [{ symbol: "baba", note: "A lawsuit headline is in the packet." }],
        picky_today: ["The bot wants Jev BUY at 85% or higher."],
        caveats: ["This note does not place trades."],
      }),
    );

    expect(parsed.names_to_watch[0]?.symbol).toBe("BABA");
    expect(parsed.picky_today).toHaveLength(1);
  });

  it("drops names that are not in the headline packet", () => {
    const brief = parseMorningBriefText(
      JSON.stringify({
        headline: "Two names",
        names_to_watch: [
          { symbol: "BABA", note: "Lawsuit headline." },
          { symbol: "NVDA", note: "Invented." },
        ],
        picky_today: [],
        caveats: [],
      }),
    );

    const constrained = constrainMorningBrief(brief, new Set(["BABA"]));
    expect(constrained.names_to_watch.map((row) => row.symbol)).toEqual(["BABA"]);
  });

  it("rejects a missing headline", () => {
    expect(() =>
      parseMorningBriefText(
        JSON.stringify({
          headline: "  ",
          names_to_watch: [],
          picky_today: [],
          caveats: [],
        }),
      ),
    ).toThrow(/headline/);
  });
});
