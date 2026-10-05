import { describe, expect, it } from "vitest";
import { buildSettingDiffs } from "@/lib/session-brief/setting-diff";
import { settingsFixture } from "@/lib/test-support/settings";

describe("buildSettingDiffs", () => {
  it("steps known settings and ignores keep or unknown names", () => {
    const diffs = buildSettingDiffs(
      settingsFixture({
        minimum_jev_confidence: 0.85,
        signal_record_threshold: 0.5,
        stop_loss_percentage: 0.01,
        min_volume_ratio: 0,
      }),
      [
        { setting: "minimum_jev_confidence", direction: "raise", why: "Skips were close." },
        { setting: "stop_loss_percentage", direction: "lower", why: "Stops were wide." },
        { setting: "min_volume_ratio", direction: "lower", why: "Already off." },
        { setting: "Max spread", direction: "raise", why: "Old brief wording." },
        { setting: "max_open_positions", direction: "keep", why: "Fine." },
      ],
    );

    expect(diffs.map((row) => row.key)).toEqual([
      "minimum_jev_confidence",
      "stop_loss_percentage",
    ]);
    expect(diffs[0]).toMatchObject({
      currentLabel: "85%",
      proposedLabel: "86%",
      proposed: 86,
    });
    expect(diffs[1]).toMatchObject({
      currentLabel: "1%",
      proposedLabel: "0.9%",
      proposed: 0.9,
    });
  });

  it("does not raise the record threshold above min confidence", () => {
    const diffs = buildSettingDiffs(
      settingsFixture({
        minimum_jev_confidence: 0.85,
        signal_record_threshold: 0.85,
      }),
      [{ setting: "signal_record_threshold", direction: "raise", why: "Too low." }],
    );

    expect(diffs).toEqual([]);
  });

  it("drops a conflicting second diff so Apply would pass Save", () => {
    const diffs = buildSettingDiffs(
      settingsFixture({
        stop_loss_percentage: 0.01,
        take_profit_percentage: 0.012,
      }),
      [
        { setting: "take_profit_percentage", direction: "lower", why: "Take sooner." },
        { setting: "stop_loss_percentage", direction: "raise", why: "Wider stop." },
      ],
    );

    expect(diffs.map((row) => row.key)).toEqual(["take_profit_percentage"]);
  });

  it("skips lowering max hold below min hold", () => {
    const diffs = buildSettingDiffs(
      settingsFixture({ max_hold_minutes: 20, min_hold_minutes: 15 }),
      [{ setting: "max_hold_minutes", direction: "lower", why: "Shorter holds." }],
    );

    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.proposed).toBe(15);
  });
});
