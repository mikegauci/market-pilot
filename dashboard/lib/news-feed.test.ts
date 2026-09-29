import { describe, expect, it } from "vitest";
import {
  buildNewsFeedItems,
  filterNewsFeedItems,
  hasNewsSignal,
  isBreakingNews,
  isFreshNews,
  isSafeHttpUrl,
  normalizeHeadline,
  sentimentLabel,
} from "@/lib/news-feed";
import type { MarketNewsRow } from "@/lib/types/database";

function row(
  overrides: Partial<MarketNewsRow> & {
    id: number;
    headline: string;
    published_at: string;
  },
): MarketNewsRow {
  return {
    summary: null,
    url: null,
    source: null,
    image: null,
    category: "general",
    related: null,
    related_symbols: [],
    fetched_at: overrides.published_at,
    sentiment: null,
    tags: [],
    ...overrides,
  };
}

describe("hasNewsSignal", () => {
  it("returns false when snapshot has no news fields", () => {
    expect(hasNewsSignal(null)).toBe(false);
    expect(hasNewsSignal({})).toBe(false);
  });

  it("returns true when any news field is present", () => {
    expect(hasNewsSignal({ news_top_headline: "Earnings beat" })).toBe(true);
    expect(hasNewsSignal({ news_sentiment: 0.4 })).toBe(true);
    expect(hasNewsSignal({ news_tags: ["earnings"] })).toBe(true);
  });
});

describe("buildNewsFeedItems", () => {
  const nowMs = Date.parse("2026-01-02T15:00:00Z");

  it("sorts by published_at and maps source/url/summary", () => {
    const items = buildNewsFeedItems(
      [
        row({
          id: 1,
          headline: "Older story",
          source: "Reuters",
          url: "https://example.com/old",
          summary: "Yesterday.",
          published_at: "2026-01-02T10:00:00Z",
        }),
        row({
          id: 2,
          headline: "Newer story",
          source: "Bloomberg",
          url: "https://example.com/new",
          summary: "Just in.",
          published_at: "2026-01-02T14:00:00Z",
        }),
      ],
      nowMs,
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      headline: "Newer story",
      source: "Bloomberg",
      url: "https://example.com/new",
      summary: "Just in.",
    });
  });

  it("marks trending when the same headline appears twice", () => {
    const items = buildNewsFeedItems(
      [
        row({
          id: 1,
          headline: "Chip sector rallies",
          published_at: "2026-01-02T14:00:00Z",
        }),
        row({
          id: 2,
          headline: "Chip sector rallies",
          published_at: "2026-01-02T13:00:00Z",
        }),
      ],
      nowMs,
    );
    expect(items.every((item) => item.isTrending)).toBe(true);
  });

  it("marks trending for high sentiment or multiple related symbols", () => {
    const items = buildNewsFeedItems(
      [
        row({
          id: 1,
          headline: "Hot move",
          sentiment: 0.4,
          published_at: "2026-01-02T14:00:00Z",
        }),
        row({
          id: 2,
          headline: "Wide tape",
          related_symbols: ["AAPL", "MSFT"],
          published_at: "2026-01-02T13:00:00Z",
        }),
      ],
      nowMs,
    );
    expect(items.every((item) => item.isTrending)).toBe(true);
  });

  it("drops non-http urls", () => {
    const items = buildNewsFeedItems(
      [
        row({
          id: 1,
          headline: "Bad link",
          url: "javascript:alert(1)",
          published_at: "2026-01-02T14:00:00Z",
        }),
        row({
          id: 2,
          headline: "Good link",
          url: "https://example.com/ok",
          published_at: "2026-01-02T13:00:00Z",
        }),
      ],
      nowMs,
    );
    expect(items[0]?.url).toBeNull();
    expect(items[1]?.url).toBe("https://example.com/ok");
  });
});

describe("isSafeHttpUrl", () => {
  it("allows only http and https", () => {
    expect(isSafeHttpUrl("https://example.com")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});

describe("breaking and freshness heuristics", () => {
  const nowMs = Date.parse("2026-01-02T15:00:00Z");

  it("flags breaking within 2h with high impact", () => {
    expect(
      isBreakingNews({
        publishedAt: "2026-01-02T14:00:00Z",
        sentiment: -0.4,
        tags: [],
        nowMs,
      }),
    ).toBe(true);
    expect(
      isBreakingNews({
        publishedAt: "2026-01-02T14:30:00Z",
        sentiment: 0,
        tags: ["lawsuit"],
        nowMs,
      }),
    ).toBe(true);
  });

  it("flags fresh within 6h when not breaking", () => {
    expect(
      isFreshNews({
        publishedAt: "2026-01-02T12:00:00Z",
        isBreaking: false,
        nowMs,
      }),
    ).toBe(true);
  });
});

describe("filterNewsFeedItems", () => {
  const nowMs = Date.parse("2026-01-02T15:00:00Z");
  const items = buildNewsFeedItems(
    [
      row({
        id: 1,
        headline: "Apple rises",
        source: "Reuters",
        sentiment: 0.2,
        tags: ["upgrade"],
        related_symbols: ["AAPL"],
        published_at: "2026-01-02T12:00:00Z",
      }),
      row({
        id: 2,
        headline: "Cloud miss lawsuit",
        source: "Bloomberg",
        sentiment: -0.4,
        tags: ["lawsuit"],
        related_symbols: ["MSFT"],
        published_at: "2026-01-02T14:10:00Z",
      }),
    ],
    nowMs,
  );

  it("filters by source, related symbol, sentiment, tag, and badge", () => {
    expect(filterNewsFeedItems(items, { source: "Reuters" })).toHaveLength(1);
    expect(filterNewsFeedItems(items, { relatedSymbol: "MSFT" })[0]?.id).toBe("2");
    expect(filterNewsFeedItems(items, { sentiment: "bearish" })).toHaveLength(1);
    expect(filterNewsFeedItems(items, { tag: "lawsuit" })[0]?.id).toBe("2");
    expect(filterNewsFeedItems(items, { badge: "breaking" })[0]?.id).toBe("2");
    expect(filterNewsFeedItems(items, { badge: "fresh" })[0]?.id).toBe("1");
  });
});

describe("sentimentLabel", () => {
  it("classifies by thresholds including ±0.1 boundaries", () => {
    expect(sentimentLabel(0.2)).toBe("bullish");
    expect(sentimentLabel(-0.2)).toBe("bearish");
    expect(sentimentLabel(0.1)).toBe("neutral");
  });
});

describe("normalizeHeadline", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeHeadline("  Chip  Sector  ")).toBe("chip sector");
  });
});
