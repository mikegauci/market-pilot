import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_STALE_SEC,
  JEV_UNAVAILABLE_GRACE_SEC,
  isStopRequestStale,
  isTraderOnline,
  shouldShowJevUnavailableWarning,
} from "@/lib/trader-status";

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

describe("shouldShowJevUnavailableWarning", () => {
  const now = Date.parse("2026-10-07T19:00:00.000Z");

  it("shows after grace when Jev is off during the session", () => {
    const hb = new Date(now - (JEV_UNAVAILABLE_GRACE_SEC + 5) * 1000).toISOString();
    expect(
      shouldShowJevUnavailableWarning(
        { last_heartbeat: hb, jev_connected: false },
        { traderOnline: true, marketOpen: true },
        now,
      ),
    ).toBe(true);
  });

  it("hides during startup grace", () => {
    const hb = new Date(now - 30 * 1000).toISOString();
    expect(
      shouldShowJevUnavailableWarning(
        { last_heartbeat: hb, jev_connected: false },
        { traderOnline: true, marketOpen: true },
        now,
      ),
    ).toBe(false);
  });

  it("hides when Jev is connected or the market is closed", () => {
    const hb = new Date(now - 120 * 1000).toISOString();
    expect(
      shouldShowJevUnavailableWarning(
        { last_heartbeat: hb, jev_connected: true },
        { traderOnline: true, marketOpen: true },
        now,
      ),
    ).toBe(false);
    expect(
      shouldShowJevUnavailableWarning(
        { last_heartbeat: hb, jev_connected: false },
        { traderOnline: true, marketOpen: false },
        now,
      ),
    ).toBe(false);
  });
});
