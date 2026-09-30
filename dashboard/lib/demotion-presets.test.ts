import { describe, expect, it } from "vitest";
import { holdPolicyFromRatio } from "@/lib/demotion-presets";

describe("holdPolicyFromRatio", () => {
  it("treats missing and low ratios as exit now", () => {
    expect(holdPolicyFromRatio(null)).toBe("exit_now");
    expect(holdPolicyFromRatio(undefined)).toBe("exit_now");
    expect(holdPolicyFromRatio(0)).toBe("exit_now");
    expect(holdPolicyFromRatio(0.25)).toBe("exit_now");
  });

  it("treats the middle band as tighten", () => {
    expect(holdPolicyFromRatio(0.26)).toBe("tighten");
    expect(holdPolicyFromRatio(0.5)).toBe("tighten");
    expect(holdPolicyFromRatio(0.74)).toBe("tighten");
  });

  it("treats high ratios as keep", () => {
    expect(holdPolicyFromRatio(0.75)).toBe("keep");
    expect(holdPolicyFromRatio(1)).toBe("keep");
  });
});
