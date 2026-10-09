import { describe, expect, it } from "vitest";
import { buildSkipScenarios } from "@/lib/skip-scenarios";
import type { ChartFrame, ChecklistFrame, QuoteFrame } from "@/lib/strategy-scenarios";
import { settingsFixture } from "@/lib/test-support/settings";

function find(id: string, overrides = {}) {
  const found = buildSkipScenarios(settingsFixture(overrides)).find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("buildSkipScenarios", () => {
  it("returns the eight skip reasons in glossary order, 3 steps each", () => {
    const scenarios = buildSkipScenarios(settingsFixture());
    expect(scenarios.map((item) => item.id)).toEqual([
      "volume_too_low",
      "price_below_ema20",
      "ema_warming_up",
      "max_entries_per_symbol",
      "reentry_cooldown",
      "spread_too_wide",
      "rsi_overbought",
      "benchmark_headwind",
    ]);
    for (const item of scenarios) expect(item.steps).toHaveLength(3);
  });

  it("is deterministic", () => {
    expect(buildSkipScenarios(settingsFixture())).toEqual(buildSkipScenarios(settingsFixture()));
  });

  it("keeps every chart cursor in range", () => {
    for (const item of buildSkipScenarios(settingsFixture({ reentry_cooldown_minutes: 90 }))) {
      for (const step of item.steps) {
        if (step.frame.kind !== "chart") continue;
        expect(step.frame.cursor).toBeLessThan(step.frame.prices.length);
        expect(step.frame.volumes.length).toBe(step.frame.prices.length);
      }
    }
  });
});

describe("missing settings", () => {
  it("builds all eight scenarios from defaults when there is no settings row", () => {
    expect(buildSkipScenarios(null)).toHaveLength(8);
    expect(buildSkipScenarios(null)).toEqual(buildSkipScenarios({}));
  });
});

describe("volume", () => {
  it("skips below the configured ratio and passes above it", () => {
    const steps = find("volume_too_low", { min_volume_ratio: 1.2 }).steps;
    const skip = steps[1]!.frame as ChartFrame;
    const base = skip.volumes.slice(10, 20).reduce((a, b) => a + b, 0) / 10;
    expect(skip.volumes[skip.cursor]! / base).toBeLessThan(1.2);
    const pass = steps[2]!.frame as ChartFrame;
    expect(pass.volumes[pass.cursor]! / base).toBeGreaterThan(1.2);
    expect(steps[1]!.body).toContain("at least 1.2×");
  });

  it("says it's off when the ratio is 0", () => {
    expect(find("volume_too_low", { min_volume_ratio: 0 }).steps[1]!.body).toContain("is off right now");
  });
});

describe("ema", () => {
  it("dips under then reclaims the EMA line", () => {
    const steps = find("price_below_ema20", { entry_ema_gate: "ema_20" }).steps;
    const dip = steps[1]!.frame as ChartFrame;
    expect(dip.prices[dip.cursor]!).toBeLessThan(dip.ema!.values[dip.cursor]!);
    const back = steps[2]!.frame as ChartFrame;
    expect(back.prices[back.cursor]!).toBeGreaterThan(back.ema!.values[back.cursor]!);
  });

  it("switches to EMA-9 and its warm-up length", () => {
    const below = find("price_below_ema20", { entry_ema_gate: "ema_9" });
    expect((below.steps[0]!.frame as ChartFrame).ema!.label).toBe("EMA-9");
    const warm = find("ema_warming_up", { entry_ema_gate: "ema_9" }).steps[2]!.frame as ChartFrame;
    expect(warm.ema!.values.findIndex((v) => v != null)).toBe(8);
  });

  it("names the EMA-9 skip reason the trader actually logs", () => {
    const below = find("price_below_ema20", { entry_ema_gate: "ema_9" });
    expect(below.title).toBe("Price below EMA-9");
    expect(below.steps[1]!.body).toContain('"Price below EMA-9"');
    expect(find("price_below_ema20", { entry_ema_gate: "ema_20" }).title).toBe("Price below EMA-20");
  });

  it("notes when the trend rule is off", () => {
    expect(find("price_below_ema20", { entry_ema_gate: "off" }).steps[1]!.body).toContain("is off right now");
  });
});

describe("entries and cooldown", () => {
  it("shows N passes then a failure at the daily limit", () => {
    const frame = find("max_entries_per_symbol", { max_entries_per_symbol_per_day: 4 }).steps[1]!
      .frame as ChecklistFrame;
    expect(frame.checks.filter((c) => c.state === "pass")).toHaveLength(4);
    expect(frame.checks.at(-1)!.state).toBe("fail");
  });

  it("uses the cooldown length for the band", () => {
    const frame = find("reentry_cooldown", { reentry_cooldown_minutes: 30 }).steps[1]!.frame as ChartFrame;
    expect(frame.windowBand!.toIndex - frame.windowBand!.fromIndex).toBe(30);
    expect(frame.windowBand!.label).toBe("30-min cooldown");
  });
});

describe("spread, RSI and benchmark", () => {
  it("fails above the spread cap and passes below it", () => {
    const steps = find("spread_too_wide", { max_spread_pct: 0.002 }).steps;
    const wide = steps[0]!.frame as QuoteFrame;
    const narrow = steps[2]!.frame as QuoteFrame;
    expect(wide.capPct).toBeCloseTo(0.2);
    expect(wide.spreadPct).toBeGreaterThan(wide.capPct);
    expect(narrow.spreadPct).toBeLessThanOrEqual(narrow.capPct);
  });

  it("puts RSI over the cap, then under it", () => {
    const steps = find("rsi_overbought", { max_rsi: 65 }).steps;
    const hot = (steps[1]!.frame as ChartFrame).rsi!;
    expect(hot.value).toBeGreaterThan(65);
    expect((steps[2]!.frame as ChartFrame).rsi!.value).toBeLessThanOrEqual(65);
  });

  it("explains an RSI cap too high to ever skip, and still shows RSI over the shown cap", () => {
    const steps = find("rsi_overbought", { max_rsi: 100 }).steps;
    const hot = (steps[1]!.frame as ChartFrame).rsi!;
    expect(hot.value).toBeGreaterThan(hot.normalCap);
    expect(steps[1]!.body).toContain("too high for this check to ever skip");
  });

  it("keeps the narrow spread under a tiny cap", () => {
    const steps = find("spread_too_wide", { max_spread_pct: 0.00002 }).steps;
    const narrow = steps[2]!.frame as QuoteFrame;
    expect(narrow.spreadPct).toBeLessThanOrEqual(narrow.capPct);
    expect((steps[0]!.frame as QuoteFrame).spreadPct).toBeGreaterThan(narrow.capPct);
  });

  it("keeps the benchmark's first step calm", () => {
    const quiet = find("benchmark_headwind").steps[0]!.frame as ChartFrame;
    const change = ((quiet.prices[quiet.cursor]! - quiet.prices[quiet.cursor - 5]!) / quiet.prices[quiet.cursor - 5]!) * 100;
    expect(change).toBeGreaterThan(-0.12);
  });

  it("drops past the benchmark limit, then recovers", () => {
    const steps = find("benchmark_headwind", { benchmark_symbol: "QQQ" }).steps;
    const drop = steps[1]!.frame as ChartFrame;
    const change = ((drop.prices[drop.cursor]! - drop.prices[drop.cursor - 5]!) / drop.prices[drop.cursor - 5]!) * 100;
    expect(change).toBeLessThan(-0.12);
    expect(steps[1]!.body).toContain("QQQ");
    const back = steps[2]!.frame as ChartFrame;
    const recovered = ((back.prices[back.cursor]! - back.prices[back.cursor - 5]!) / back.prices[back.cursor - 5]!) * 100;
    expect(recovered).toBeGreaterThan(-0.12);
  });
});
