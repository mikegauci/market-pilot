import { describe, expect, it } from "vitest";
import { LIVE_POLL_ONLY_TABLES } from "@/lib/live-data-config";

describe("latest predictions live config", () => {
  it("polls predictions without Realtime subscriptions", () => {
    expect(LIVE_POLL_ONLY_TABLES.has("predictions")).toBe(true);
  });
});
