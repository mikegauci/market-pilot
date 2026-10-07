import { describe, expect, it } from "vitest";
import {
  buildDeterministicPreJevSkipExplanation,
  buildSkipExplainPacket,
} from "@/lib/skip-explainer/packet";
import { settingsFixture } from "@/lib/test-support/settings";
import type { Prediction } from "@/lib/types/database";

function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: "pred-1",
    symbol: "BABA",
    timestamp: "2026-10-05T14:00:00.000Z",
    price: 100,
    buy_probability: 0.86,
    hold_probability: 0.1,
    sell_probability: 0.04,
    trade_created: false,
    trade_skip_reason: "spread_too_wide (0.200%)",
    market_snapshot: {
      spread: 0.2,
      rsi: 62,
      ema_20: 98,
      volume_ratio: 1.2,
      benchmark_change_5m: -0.05,
      news_sentiment: 0.1,
      news_tags: [],
      news_top_headline: "BABA rises",
    },
    created_at: "2026-10-05T14:00:00.000Z",
    ...overrides,
  };
}

describe("buildSkipExplainPacket", () => {
  it("turns the skip and snapshot into percents the model can quote", () => {
    const packet = buildSkipExplainPacket(
      prediction(),
      settingsFixture({ minimum_jev_confidence: 0.8 }),
    );

    expect(packet.symbol).toBe("BABA");
    expect(packet.buy_pct).toBe(86);
    expect(packet.skip_reason_label).toBe("Spread too wide");
    expect(packet.snapshot.spread_pct).toBe(0.2);
    expect(packet.snapshot.price_vs_ema20).toBe("above");
    expect(packet.buy_minus_min_confidence_pct_points).toBe(6);
    expect(packet.gates.minimum_jev_confidence_pct).toBe(80);
    expect(packet.gates.max_spread_pct).toBe(0.15);
    expect(packet.gates.min_share_price).toBe(20);
    expect(packet.jev_was_called).toBe(true);
  });

  it("marks pre-Jev filter skips so explainers do not treat 0% as Jev output", () => {
    const packet = buildSkipExplainPacket(
      prediction({
        buy_probability: 0,
        hold_probability: 0,
        sell_probability: 0,
        trade_skip_reason: "rsi_overbought (77.0)",
      }),
      settingsFixture(),
    );

    expect(packet.jev_was_called).toBe(false);
    expect(packet.note).toContain("jev_was_called is false");

    const explanation = buildDeterministicPreJevSkipExplanation(packet);
    expect(explanation.closeness).toBe("hard_block");
    expect(explanation.summary).toContain("Jev was not called");
    expect(explanation.summary).not.toMatch(/Jev recorded/i);
  });

  it("marks price below EMA when the snapshot says so", () => {
    const packet = buildSkipExplainPacket(
      prediction({
        price: 90,
        market_snapshot: { ema_20: 98 },
        trade_skip_reason: "price_below_ema20",
      }),
      settingsFixture(),
    );

    expect(packet.snapshot.price_vs_ema20).toBe("below");
    expect(packet.skip_reason_label).toBe("Price below EMA-20");
    expect(packet.snapshot.spread_pct).toBeNull();
  });
});
