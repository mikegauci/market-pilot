import { describe, expect, it } from "vitest";
import {
  SETTING_FIELD_EXAMPLES,
  strategyHelpHref,
} from "@/lib/settings-field-meta";

describe("settings-field-meta", () => {
  it("builds strategy hash links", () => {
    expect(strategyHelpHref("entry-filters")).toBe("/strategy#entry-filters");
  });

  it("defines examples for entry filter keys", () => {
    expect(SETTING_FIELD_EXAMPLES.min_volume_ratio).toContain("volume_too_low");
    expect(SETTING_FIELD_EXAMPLES.rotation_min_session_change_pct).toBeTruthy();
  });
});
