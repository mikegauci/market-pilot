import { describe, expect, it } from "vitest";
import { HEARTBEAT_STALE_SEC, isStopRequestStale, isTraderOnline } from "@/lib/trader-status";

describe("isStopRequestStale", () => {
  const now = Date.parse("2026-10-05T14:00:00.000Z");

  it("is stale when stop is set and heartbeat is old", () => {
    const hb = new Date(now - (HEARTBEAT_STALE_SEC + 10) * 1000).toISOString();
    expect(
      isStopRequestStale({ shutdown_requested: true, last_heartbeat: hb }, now),
    ).toBe(true);
  });

  it("is not stale while the trader is still online", () => {
    const hb = new Date(now - 5 * 1000).toISOString();
    expect(isTraderOnline(hb, now)).toBe(true);
    expect(
      isStopRequestStale({ shutdown_requested: true, last_heartbeat: hb }, now),
    ).toBe(false);
  });
});
