import { describe, expect, it } from "vitest";
import {
  isIncompleteSettingsNumberDraft,
  parseSettingsNumberDraft,
} from "@/lib/settings-number-draft";

describe("parseSettingsNumberDraft", () => {
  it("returns null for empty input instead of zero", () => {
    expect(parseSettingsNumberDraft("", false)).toBeNull();
    expect(parseSettingsNumberDraft("", true)).toBeNull();
  });

  it("parses integers and decimals", () => {
    expect(parseSettingsNumberDraft("3", true)).toBe(3);
    expect(parseSettingsNumberDraft("1.25", false)).toBe(1.25);
  });
});

describe("isIncompleteSettingsNumberDraft", () => {
  it("allows trailing decimal while typing", () => {
    expect(isIncompleteSettingsNumberDraft("1.")).toBe(true);
    expect(isIncompleteSettingsNumberDraft("1.2")).toBe(false);
  });
});
