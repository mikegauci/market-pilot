import { describe, expect, it, vi } from "vitest";
import { checkViewerSignInCooldown } from "@/lib/viewer-sign-in-cooldown";

describe("checkViewerSignInCooldown", () => {
  it("allows first attempt and blocks rapid repeats", () => {
    vi.useFakeTimers();
    expect(checkViewerSignInCooldown("1.2.3.4")).toBeNull();
    expect(checkViewerSignInCooldown("1.2.3.4")).toMatch(/wait a few seconds/i);
    vi.advanceTimersByTime(3_500);
    expect(checkViewerSignInCooldown("1.2.3.4")).toBeNull();
    vi.useRealTimers();
  });
});
