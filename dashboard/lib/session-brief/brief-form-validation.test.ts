import { describe, expect, it } from "vitest";
import {
  briefFormSliceFromSettings,
  validateBriefFormSlice,
} from "@/lib/session-brief/brief-form-validation";
import { settingsFixture } from "@/lib/test-support/settings";

describe("validateBriefFormSlice", () => {
  it("accepts a typical slice", () => {
    const slice = briefFormSliceFromSettings(settingsFixture());
    expect(validateBriefFormSlice(slice)).toBeNull();
  });

  it("rejects record threshold above min confidence", () => {
    const slice = briefFormSliceFromSettings(
      settingsFixture({
        minimum_jev_confidence: 0.84,
        signal_record_threshold: 0.85,
      }),
    );
    expect(validateBriefFormSlice(slice)).toMatch(/Signal record/);
  });

  it("rejects take profit at or below stop loss", () => {
    const slice = briefFormSliceFromSettings(
      settingsFixture({
        stop_loss_percentage: 0.011,
        take_profit_percentage: 0.011,
      }),
    );
    expect(validateBriefFormSlice(slice)).toMatch(/Take profit/);
  });

  it("rejects max hold below min hold", () => {
    const slice = briefFormSliceFromSettings(
      settingsFixture({ max_hold_minutes: 10, min_hold_minutes: 15 }),
    );
    expect(validateBriefFormSlice(slice)).toMatch(/Min hold/);
  });
});
