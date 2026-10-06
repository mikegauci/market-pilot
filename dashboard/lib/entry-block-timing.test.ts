import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  msUntilBlockExpires,
  msUntilNextRotation,
} from "@/lib/entry-block-timing";

describe("entry-block-timing", () => {
  it("computes ms until block expires", () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    const blockedAt = "2026-01-01T11:50:00.000Z";
    expect(msUntilBlockExpires(blockedAt, 15, now)).toBe(5 * 60_000);
  });

  it("computes ms until next rotation", () => {
    const now = Date.parse("2026-01-01T12:10:00.000Z");
    const last = "2026-01-01T12:00:00.000Z";
    expect(msUntilNextRotation(last, 15, now)).toBe(5 * 60_000);
  });

  it("formats countdown labels", () => {
    expect(formatCountdown(90_000)).toBe("1m 30s");
    expect(formatCountdown(4_000)).toBe("4s");
  });
});
