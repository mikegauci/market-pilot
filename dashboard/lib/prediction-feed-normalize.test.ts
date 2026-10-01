import { describe, expect, it } from "vitest";
import {
  mapLatestPredictionRpcRows,
  normalizePredictionFeedRows,
} from "@/lib/prediction-feed-normalize";

describe("normalizePredictionFeedRows", () => {
  it("builds news-only market_snapshot from JSON aliases", () => {
    const [row] = normalizePredictionFeedRows([
      {
        id: "p1",
        symbol: "NVDA",
        timestamp: "2026-01-01T12:00:00Z",
        price: 100,
        buy_probability: 0.9,
        hold_probability: 0.05,
        sell_probability: 0.05,
        trade_created: false,
        trade_skip_reason: null,
        created_at: "2026-01-01T12:00:00Z",
        news_sentiment: 0.4,
        news_top_headline: "Test headline",
        news_tags: ["earnings"],
      },
    ]);
    expect(row?.market_snapshot?.news_top_headline).toBe("Test headline");
    expect(row?.market_snapshot?.news_sentiment).toBe(0.4);
  });
});

describe("mapLatestPredictionRpcRows", () => {
  it("sorts symbols alphabetically", () => {
    const rows = mapLatestPredictionRpcRows([
      {
        id: "2",
        symbol: "ZZZ",
        timestamp: "2026-01-01T12:00:00Z",
        price: 1,
        buy_probability: 0.5,
        hold_probability: 0.25,
        sell_probability: 0.25,
        trade_created: false,
        trade_skip_reason: null,
        created_at: "2026-01-01T12:00:00Z",
        market_snapshot: {},
      },
      {
        id: "1",
        symbol: "AAA",
        timestamp: "2026-01-01T12:00:00Z",
        price: 1,
        buy_probability: 0.5,
        hold_probability: 0.25,
        sell_probability: 0.25,
        trade_created: false,
        trade_skip_reason: null,
        created_at: "2026-01-01T12:00:00Z",
        market_snapshot: {},
      },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["AAA", "ZZZ"]);
  });
});
