import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  assertDashboardCanWrite,
  canDashboardWrite,
  getDashboardRole,
  isDashboardReadOnly,
  isReadOnlyUser,
  readOnlyActionError,
  READ_ONLY_ACTION_MESSAGE,
} from "@/lib/dashboard-role";

function userWithRole(role: string | undefined): User {
  return {
    id: "u1",
    app_metadata: role === undefined ? {} : { dashboard_role: role },
  } as User;
}

describe("dashboard-role", () => {
  it("classifies owner and viewer from app_metadata", () => {
    expect(getDashboardRole(userWithRole("owner"))).toBe("owner");
    expect(getDashboardRole(userWithRole("viewer"))).toBe("viewer");
    expect(getDashboardRole(userWithRole("other"))).toBe("unknown");
    expect(getDashboardRole(null)).toBe("unknown");
  });

  it("treats only owner as writable", () => {
    expect(canDashboardWrite(userWithRole("owner"))).toBe(true);
    expect(canDashboardWrite(userWithRole("viewer"))).toBe(false);
    expect(canDashboardWrite(userWithRole(undefined))).toBe(false);
    expect(isReadOnlyUser(userWithRole("viewer"))).toBe(true);
  });

  it("isDashboardReadOnly is true for viewer and unknown roles", () => {
    expect(isDashboardReadOnly(userWithRole("viewer"))).toBe(true);
    expect(isDashboardReadOnly(userWithRole(undefined))).toBe(true);
    expect(isDashboardReadOnly(userWithRole("owner"))).toBe(false);
    expect(isDashboardReadOnly(null)).toBe(false);
  });

  it("readOnlyActionError returns stable message", () => {
    const result = readOnlyActionError();
    expect(result.ok).toBe(false);
    expect(result.error).toBe(READ_ONLY_ACTION_MESSAGE);
  });

  it("assertDashboardCanWrite throws for non-owner", () => {
    expect(() => assertDashboardCanWrite(userWithRole("viewer"))).toThrow(
      READ_ONLY_ACTION_MESSAGE,
    );
    expect(() => assertDashboardCanWrite(userWithRole("owner"))).not.toThrow();
  });
});
