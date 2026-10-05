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
});
