import { describe, expect, it } from "vitest";
import {
  assessMarketCondition,
  averageRecentNewsSentiment,
  extractBenchmarkChange5m,
  marketConditionFromLiveData,
} from "@/lib/market-condition";
import type { MarketNewsRow, Prediction } from "@/lib/types/database";

function prediction(
  symbol: string,
  snapshot: Prediction["market_snapshot"],
): Prediction {
  return {
    id: symbol,
    symbol,
    timestamp: "2026-09-29T14:00:00Z",
    price: 10,
    buy_probability: 0.5,
    hold_probability: 0.3,
    sell_probability: 0.2,
    trade_created: false,
    market_snapshot: snapshot,
    created_at: "2026-09-29T14:00:00Z",
  };
}

function newsRow(sentiment: number | null, publishedAt: string): MarketNewsRow {
  return {
    id: 1,
    headline: "Test",
    summary: null,
    url: null,
    source: null,
    image: null,
    category: "general",
    related: null,
    related_symbols: [],
    published_at: publishedAt,
    fetched_at: publishedAt,
    sentiment,
    tags: [],
  };
}

describe("extractBenchmarkChange5m", () => {
  it("prefers the benchmark symbol snapshot", () => {
    const value = extractBenchmarkChange5m(
      [
        prediction("BABA", { benchmark_change_5m: -0.1 }),
        prediction("EEM", { benchmark_change_5m: 0.25 }),
      ],
      "EEM",
    );
    expect(value).toBe(0.25);
  });

  it("falls back to spy_change_5m and any snapshot", () => {
    expect(
      extractBenchmarkChange5m([prediction("BABA", { spy_change_5m: -0.4 })], "EEM"),
    ).toBe(-0.4);
  });
});

describe("averageRecentNewsSentiment", () => {
  const now = Date.parse("2026-09-29T16:00:00Z");

  it("averages sentiments inside the lookback window", () => {
    const avg = averageRecentNewsSentiment(
      [
        newsRow(0.4, "2026-09-29T15:00:00Z"),
        newsRow(-0.2, "2026-09-29T14:30:00Z"),
        newsRow(0.8, "2026-09-28T10:00:00Z"),
      ],
      now,
    );
    expect(avg).toBeCloseTo(0.1);
  });

  it("returns null when nothing recent", () => {
    expect(
      averageRecentNewsSentiment([newsRow(0.5, "2026-09-20T10:00:00Z")], now),
    ).toBeNull();
  });
});

describe("assessMarketCondition", () => {
  it("marks closed sessions", () => {
    const result = assessMarketCondition({
      isMarketOpen: false,
      benchmarkChange5m: 0.2,
      newsSentiment: 0.1,
    });
    expect(result.level).toBe("closed");
    expect(result.label).toBe("Closed");
    expect(result.hint).toMatch(/will not open new trades/i);
  });

  it("marks favorable when benchmark and news are supportive", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      benchmarkChange5m: 0.15,
      newsSentiment: 0.2,
    });
    expect(result.level).toBe("favorable");
    expect(result.label).toBe("Favorable");
    expect(result.hint).toMatch(/allow new buys/i);
    expect(result.hint).toMatch(/other filters may still skip/i);
    expect(result.factors.find((f) => f.key === "benchmark")?.label).toMatch(
      /Broad market \(EEM, 5 min\)/,
    );
    expect(result.factors.find((f) => f.key === "news")?.detail).toMatch(
      /blocks at -0\.3 or below/,
    );
  });

  it("marks caution when soft but above floors", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      benchmarkChange5m: -0.08,
      newsSentiment: 0,
    });
    expect(result.level).toBe("caution");
    expect(result.hint).toMatch(/still allow new buys/i);
    expect(result.hint).toMatch(/other filters may skip/i);
  });

  it("marks headwind when benchmark breaches the floor", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      benchmarkChange5m: -0.45,
      newsSentiment: 0.1,
    });
    expect(result.level).toBe("headwind");
    expect(result.summary).toMatch(/EEM too weak/i);
    expect(result.hint).toMatch(/blocks most new buys/i);
    expect(result.factors.find((f) => f.key === "benchmark")?.detail).toMatch(
      /cutoff -0\.12%/,
    );
  });

  it("marks headwind when news is bearish enough to block", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      benchmarkChange5m: 0.1,
      newsSentiment: -0.35,
    });
    expect(result.level).toBe("headwind");
    expect(result.summary).toMatch(/bearish news/i);
  });

  it("marks unknown when open but no readings", () => {
    const result = assessMarketCondition({
      isMarketOpen: true,
      benchmarkChange5m: null,
      newsSentiment: null,
    });
    expect(result.level).toBe("unknown");
    expect(result.hint).toMatch(/No recommendation yet/i);
  });
});

describe("marketConditionFromLiveData", () => {
  it("combines predictions and news", () => {
    const now = Date.parse("2026-09-29T16:00:00Z");
    const result = marketConditionFromLiveData({
      isMarketOpen: true,
      benchmarkSymbol: "EEM",
      nowMs: now,
      predictions: [prediction("EEM", { benchmark_change_5m: -0.5 })],
      news: [newsRow(0.1, "2026-09-29T15:00:00Z")],
    });
    expect(result.level).toBe("headwind");
    expect(result.benchmarkChange5m).toBe(-0.5);
  });
});
