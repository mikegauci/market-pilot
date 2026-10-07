import { describe, expect, it } from "vitest";
import {
  diffSettingsFormDraft,
  settingsToFormDraft,
} from "@/lib/settings-form-changes";
import { settingsFixture } from "@/lib/test-support/settings";

describe("diffSettingsFormDraft", () => {
  it("lists changed fields with formatted before and after", () => {
    const saved = settingsToFormDraft(settingsFixture());
    const draft = {
      ...saved,
      max_open_positions: 4,
      take_profit_percentage: 0.03,
    };

    const changes = diffSettingsFormDraft(saved, draft, "USD");
    expect(changes.map((row) => row.key)).toEqual([
      "max_open_positions",
      "take_profit_percentage",
    ]);
    expect(changes[0]?.fromLabel).toBe("2");
    expect(changes[0]?.toLabel).toBe("4");
    expect(changes[1]?.fromLabel).toBe("1.5%");
    expect(changes[1]?.toLabel).toBe("3%");
  });

  it("returns no changes when draft matches saved", () => {
    const saved = settingsToFormDraft(settingsFixture());
    expect(diffSettingsFormDraft(saved, saved, "USD")).toHaveLength(0);
  });
});
