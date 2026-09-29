import { describe, expect, it } from "vitest";
import {
  demotionHoldPolicyLabel,
  holdPolicyFromRatio,
  holdPolicyToRatio,
} from "@/lib/demotion-presets";

describe("demotion hold presets", () => {
  it("maps ratios to presets", () => {
    expect(holdPolicyFromRatio(0)).toBe("exit_now");
    expect(holdPolicyFromRatio(0.5)).toBe("tighten");
    expect(holdPolicyFromRatio(1)).toBe("keep");
  });

  it("maps presets to stored ratios", () => {
    expect(holdPolicyToRatio("exit_now")).toBe(0);
    expect(holdPolicyToRatio("tighten")).toBe(0.5);
    expect(holdPolicyToRatio("keep")).toBe(1);
  });

  it("labels presets for summary copy", () => {
    expect(demotionHoldPolicyLabel(0.5)).toBe("Half max hold");
  });
});
