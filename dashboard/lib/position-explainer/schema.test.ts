import { describe, expect, it } from "vitest";
import { parsePositionExplanationText } from "@/lib/position-explainer/schema";

describe("parsePositionExplanationText", () => {
  it("parses JSON text from the model", () => {
    const parsed = parsePositionExplanationText(
      JSON.stringify({
        headline: "Still holding AAPL",
        jev_summary: "Jev last showed 70% buy.",
        next_exit: "Take profit is closest.",
        story: "Price is above entry. The idea still looks intact.",
      }),
    );
    expect(parsed.headline).toBe("Still holding AAPL");
    expect(parsed.jev_summary).toContain("70%");
  });
});
