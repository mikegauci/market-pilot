import { describe, expect, it } from "vitest";
import { parseSettingsAiSummaryText } from "@/lib/settings-summary/schema";

describe("parseSettingsAiSummaryText", () => {
  it("parses and trims section bullets", () => {
    const parsed = parseSettingsAiSummaryText(
      JSON.stringify({
        headline: "A picky paper setup with two names",
        jev_and_signals: [" 85% Jev BUY required ", "Two confirmation cycles"],
        risk_and_limits: ["2 open positions max"],
        exits_and_filters: [],
        watchlist: ["Rotation off · BABA and VALE"],
        trader_only_note: "Price must stay above EMA-20 (trader default).",
      }),
    );

    expect(parsed.headline).toContain("picky");
    expect(parsed.jev_and_signals).toHaveLength(2);
    expect(parsed.exits_and_filters).toHaveLength(0);
    expect(parsed.trader_only_note).toContain("EMA-20");
  });
});
