import { describe, expect, it } from "vitest";
import {
  activityByHour,
  aggregateSkipReasons,
  buildSignalFunnel,
  findNearMisses,
  isTradeEligible,
  normalizeSkipReasonKey,
  skipReasonLabel,
} from "@/lib/skip-reason-stats";
import type { Prediction } from "@/lib/types/database";

function pred(
  overrides: Partial<Prediction> & Pick<Prediction, "id" | "symbol" | "timestamp">,
): Prediction {
  return {
    price: 100,
    buy_probability: 0.9,
    hold_probability: 0.05,
    sell_probability: 0.05,
    trade_created: false,
    trade_skip_reason: null,
    created_at: "",
    ...overrides,
  };
}

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

describe("signal funnel", () => {
  it("finds near misses and aggregates skip reasons", () => {
    const predictions: Prediction[] = [
      pred({
        id: "1",
        symbol: "AAPL",
        timestamp: "2026-01-01T10:00:00Z",
        buy_probability: 0.8,
        hold_probability: 0.1,
        sell_probability: 0.1,
        trade_skip_reason: "below_trade_threshold",
      }),
      pred({
        id: "2",
        symbol: "MSFT",
        timestamp: "2026-01-01T10:00:00Z",
        trade_created: true,
      }),
      pred({
        id: "3",
        symbol: "GOOG",
        timestamp: "2026-01-01T14:00:00Z",
        buy_probability: 0.88,
        hold_probability: 0.05,
        sell_probability: 0.07,
        trade_skip_reason: "awaiting_confirmation (1/3)",
      }),
    ];
    const nearMisses = findNearMisses(predictions, 0.75, 0.85);
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0]?.symbol).toBe("AAPL");
    const buckets = aggregateSkipReasons(predictions);
    expect(buckets.some((b) => b.key === "awaiting_confirmation")).toBe(true);

    const funnel = buildSignalFunnel(predictions, 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(3);
    expect(funnel.tradeEligible).toBe(2);
    expect(funnel.pastConfirmation).toBe(1);
    expect(funnel.pastFilters).toBe(1);
    expect(funnel.pastRisk).toBe(1);
    expect(funnel.traded).toBe(1);

    const hourly = activityByHour(predictions, 0.75, 0.85);
    expect(hourly).toHaveLength(24);
    expect(hourly[10]?.highBuy).toBe(2);
    expect(hourly[10]?.traded).toBe(1);
    expect(hourly[10]?.tradeEligible).toBe(1);
    expect(hourly[14]?.highBuy).toBe(1);
    expect(hourly[14]?.tradeEligible).toBe(1);
    expect(hourly[14]?.traded).toBe(0);
  });

  it("requires trader default BUY–HOLD margin of 0.15", () => {
    const narrowMargin = pred({
      id: "m1",
      symbol: "NVDA",
      timestamp: "2026-01-01T12:00:00Z",
      buy_probability: 0.9,
      hold_probability: 0.8,
      sell_probability: 0.05,
    });
    expect(isTradeEligible(narrowMargin, 0.85, 0.05)).toBe(true);
    expect(isTradeEligible(narrowMargin, 0.85)).toBe(false);

    const funnel = buildSignalFunnel([narrowMargin], 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(1);
    expect(funnel.tradeEligible).toBe(0);
  });

  it("does not count RECORD signals as past filters", () => {
    const recordOnly = pred({
      id: "r1",
      symbol: "META",
      timestamp: "2026-01-01T11:00:00Z",
      buy_probability: 0.8,
      hold_probability: 0.1,
      sell_probability: 0.1,
      trade_skip_reason: "below_trade_threshold",
    });
    const funnel = buildSignalFunnel([recordOnly], 0.75, 0.85);
    expect(funnel.highBuySignals).toBe(1);
    expect(funnel.tradeEligible).toBe(0);
    expect(funnel.pastConfirmation).toBe(0);
    expect(funnel.pastFilters).toBe(0);
    expect(funnel.pastRisk).toBe(0);
  });
});
