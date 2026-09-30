import { describe, expect, it } from "vitest";
import {
  allowedUserIdsFromEnv,
  buildSettingsAuditPayload,
  isUserIdAllowlisted,
} from "@/lib/allowlist";

describe("allowlist", () => {
  it("includes the seeded owner by default", () => {
    const ids = allowedUserIdsFromEnv("");
    expect(ids.has("a580f939-c1ad-4098-9221-b89506cd9291")).toBe(true);
  });

  it("merges env UUIDs", () => {
    const extra = "11111111-1111-1111-1111-111111111111";
    expect(isUserIdAllowlisted(extra, extra)).toBe(true);
    expect(isUserIdAllowlisted("00000000-0000-0000-0000-000000000000", extra)).toBe(
      false,
    );
  });
});

describe("buildSettingsAuditPayload", () => {
  it("includes action and before/after snapshots", () => {
    const payload = buildSettingsAuditPayload({
      action: "settings_update",
      actorUserId: "a580f939-c1ad-4098-9221-b89506cd9291",
      actorEmail: "mikegauci@gmail.com",
      before: { minimum_jev_confidence: 0.8 },
      after: { minimum_jev_confidence: 0.85 },
    });
    expect(payload.action).toBe("settings_update");
    expect(payload.actor_user_id).toBe("a580f939-c1ad-4098-9221-b89506cd9291");
    expect(payload.before).toEqual({ minimum_jev_confidence: 0.8 });
    expect(payload.after).toEqual({ minimum_jev_confidence: 0.85 });
  });
});
