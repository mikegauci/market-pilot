import { describe, expect, it } from "vitest";
import { assertSessionDateAllowed } from "@/lib/session-brief/session-date";

describe("assertSessionDateAllowed", () => {
  it("rejects dates before the brief timeline", () => {
    expect(assertSessionDateAllowed("2026-10-01", "2026-10-02")).toMatch(/start on/);
  });

  it("rejects future session dates", () => {
    expect(assertSessionDateAllowed("2026-10-05", "2026-10-02")).toMatch(/No prediction data/);
  });

  it("accepts in-range dates", () => {
    expect(assertSessionDateAllowed("2026-10-02", "2026-10-02")).toBeNull();
  });
});
