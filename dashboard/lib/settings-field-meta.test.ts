import { describe, expect, it } from "vitest";
import {
  SETTING_FIELD_EXAMPLES,
  settingFieldExample,
  strategyHelpHref,
} from "@/lib/settings-field-meta";
import { SETTING_DESCRIPTIONS } from "@/lib/settings-form-descriptions";

describe("settings-field-meta", () => {
  it("builds strategy hash links", () => {
    expect(strategyHelpHref("entry-filters")).toBe("/strategy#entry-filters");
  });

  it("defines inline examples for most settings fields", () => {
    const keys = Object.keys(SETTING_DESCRIPTIONS);
    const withExamples = keys.filter((key) => settingFieldExample(key as keyof typeof SETTING_DESCRIPTIONS));
    expect(withExamples.length).toBeGreaterThanOrEqual(keys.length - 1);
    expect(SETTING_FIELD_EXAMPLES.min_volume_ratio).not.toContain("volume_too_low");
    expect(SETTING_FIELD_EXAMPLES.min_volume_ratio).toContain("0.5");
  });
});
