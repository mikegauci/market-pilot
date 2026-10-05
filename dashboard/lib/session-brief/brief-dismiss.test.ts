import { describe, expect, it } from "vitest";
import { briefSettingsDismissStorageKey } from "@/lib/session-brief/brief-dismiss";

describe("briefSettingsDismissStorageKey", () => {
  it("scopes dismissal to a session date", () => {
    expect(briefSettingsDismissStorageKey("2026-10-05")).toBe(
      "market-pilot:settings-brief-applied:v1:2026-10-05",
    );
  });
});
