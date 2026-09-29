import { describe, expect, it } from "vitest";
import {
  normalizeSkipReasonKey,
  skipReasonLabel,
} from "@/lib/skip-reason-stats";

describe("normalizeSkipReasonKey", () => {
  it("keeps specific IBKR reasons distinct", () => {
    expect(
      normalizeSkipReasonKey("ibkr_ineligible (no trading permission / KID)"),
    ).toBe("ibkr_ineligible");
    expect(normalizeSkipReasonKey("ibkr_cooldown (120s left)")).toBe(
      "ibkr_cooldown",
    );
    expect(
      normalizeSkipReasonKey("ibkr_order_failed (Parent order inactive)"),
    ).toBe("ibkr_order_failed");
    expect(
      normalizeSkipReasonKey(
        "ibkr_insufficient_buying_power (need $1000, have $50)",
      ),
    ).toBe("ibkr_insufficient_buying_power");
  });

  it("labels ibkr_ineligible for the dashboard funnel", () => {
    expect(skipReasonLabel("ibkr_ineligible")).toBe(
      "Broker ineligible (KID / permission)",
    );
  });
});
