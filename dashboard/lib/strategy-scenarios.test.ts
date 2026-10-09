import { describe, expect, it } from "vitest";
import {
  breakoutExampleRsi,
  buildScenarios,
  exampleActiveList,
  type ChartFrame,
  type ChecklistFrame,
  type ChipsFrame,
  type Scenario,
} from "@/lib/strategy-scenarios";
import { settingsFixture } from "@/lib/test-support/settings";

function scenario(id: Scenario["id"], overrides = {}) {
  const found = buildScenarios(settingsFixture({ max_rsi: 75, ...overrides })).find(
    (item) => item.id === id,
  );
  if (!found) throw new Error(`missing scenario ${id}`);
  return found;
}

describe("buildScenarios", () => {
  it("returns the four scenarios with steps", () => {
    const scenarios = buildScenarios(settingsFixture());
    expect(scenarios.map((item) => item.id)).toEqual([
      "breakout",
      "steady",
      "full-list",
      "buy-flow",
    ]);
    for (const item of scenarios) expect(item.steps.length).toBeGreaterThan(2);
  });

  it("is deterministic", () => {
    expect(buildScenarios(settingsFixture())).toEqual(buildScenarios(settingsFixture()));
  });
});

describe("breakout scenario", () => {
  it("uses the lookback for the prior-high window and the RSI caps from settings", () => {
    const breakout = scenario("breakout", { breakout_lookback_minutes: 12, breakout_max_rsi: 82 });
    const quiet = breakout.steps[0]!.frame as ChartFrame;
    expect(quiet.priorHigh!.toIndex - quiet.priorHigh!.fromIndex + 1).toBe(12);

    const spike = breakout.steps[1]!.frame as ChartFrame;
    const price = spike.prices[spike.cursor]!;
    expect(price).toBeGreaterThan(spike.priorHigh!.value);
    expect(breakout.steps[1]!.body).toContain("needs 1.5×");

    const rsiStep = breakout.steps[3]!;
    const rsi = (rsiStep.frame as ChartFrame).rsi!;
    expect(rsi.value).toBe(79);
    expect(rsi.activeCap).toBe(82);
    expect(rsiStep.body).toContain("the cap is 82");
  });

  it("explains that the cap does not rise when breakout RSI is not above Max RSI", () => {
    const breakout = scenario("breakout", { breakout_max_rsi: 75 });
    const rsiStep = breakout.steps[3]!;
    expect((rsiStep.frame as ChartFrame).rsi!.activeCap).toBe(75);
    expect(rsiStep.body).toContain("cap stays at 75");
  });

  it("drops the last (weakest) active name", () => {
    const breakout = scenario("breakout", { watchlist_active_size: 6 });
    const chips = (breakout.steps[2]!.frame as ChipsFrame).chips;
    const weakest = exampleActiveList(6).at(-1);
    expect(chips.find((chip) => chip.state === "dropped")?.symbol).toBe(weakest);
    expect(chips.find((chip) => chip.state === "breakout")?.symbol).toBe("QCOM");
  });
});

describe("steady climber scenario", () => {
  it("fails the new-high and volume checks", () => {
    const steady = scenario("steady");
    const checks = (steady.steps[1]!.frame as ChecklistFrame).checks;
    expect(checks.find((check) => check.label === "New high")?.state).toBe("fail");
    expect(checks.find((check) => check.label === "Volume spike")?.state).toBe("fail");
  });

  it("marks the session check off when the floor is blank", () => {
    const steady = scenario("steady", { rotation_min_session_change_pct: null });
    const checks = (steady.steps[1]!.frame as ChecklistFrame).checks;
    expect(checks.find((check) => check.label === "Green since the open")?.state).toBe("skip");
  });
});

describe("full list scenario", () => {
  it("uses the at-once breakout limit", () => {
    const fullList = scenario("full-list", { breakout_max_promotions_per_cycle: 3 });
    const capStep = fullList.steps[3]!;
    const chips = (capStep.frame as ChipsFrame).chips;
    expect(chips.filter((chip) => chip.state === "breakout")).toHaveLength(3);
    expect(capStep.body).toContain("3 breakout names");
  });

  it("leaves nothing droppable when every name is protected", () => {
    const fullList = scenario("full-list");
    const chips = (fullList.steps[2]!.frame as ChipsFrame).chips;
    expect(chips.every((chip) => ["open", "confirming", "breakout"].includes(chip.state))).toBe(
      true,
    );
  });
});

describe("buy flow scenario", () => {
  it("ends the RSI branch with the real skip label", () => {
    const flow = scenario("buy-flow");
    const last = flow.steps.at(-1)!.frame as ChecklistFrame;
    expect(last.checks.find((check) => check.label === "RSI")?.state).toBe("fail");
    expect(last.outcome?.text).toContain("RSI overbought");
  });

  it("marks the trend filter skipped when it is off", () => {
    const flow = scenario("buy-flow", { entry_ema_gate: "off" });
    const checks = (flow.steps[2]!.frame as ChecklistFrame).checks;
    expect(checks.find((check) => check.label === "Trend filter")?.state).toBe("skip");
  });
});

describe("breakoutExampleRsi", () => {
  it("sits between the caps when the breakout cap is higher", () => {
    expect(breakoutExampleRsi(75, 82)).toBe(79);
    expect(breakoutExampleRsi(75, 76)).toBe(76);
    expect(breakoutExampleRsi(75, 70)).toBe(78);
  });
});
