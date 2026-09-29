import type { MarketNewsRow, MarketSnapshot } from "@/lib/types/database";

export const NEWS_BREAKING_WINDOW_MS = 2 * 60 * 60 * 1000;
export const NEWS_FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;

const BREAKING_TAGS = new Set([
  "lawsuit",
  "bankruptcy",
  "sec_investigation",
  "recall",
  "guidance_cut",
  "earnings_miss",
]);

export type NewsFeedItem = {
  id: string;
  headline: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  publishedAt: string;
  relatedSymbols: string[];
  sentiment: number | null;
  tags: string[];
  isBreaking: boolean;
  isFresh: boolean;
  isTrending: boolean;
};

export function hasNewsSignal(snapshot?: MarketSnapshot | null): boolean {
  if (!snapshot) return false;
  return (
    snapshot.news_sentiment != null ||
    Boolean(snapshot.news_top_headline) ||
    Boolean(snapshot.news_tags && snapshot.news_tags.length > 0) ||
    Boolean(snapshot.news_articles && snapshot.news_articles.length > 0)
  );
}

export function sentimentLabel(sentiment: number): "bullish" | "bearish" | "neutral" {
  if (sentiment > 0.1) return "bullish";
  if (sentiment < -0.1) return "bearish";
  return "neutral";
}

export function sentimentClass(sentiment: number): string {
  if (sentiment > 0.1) return "bg-emerald-900 text-emerald-300";
  if (sentiment < -0.1) return "bg-red-900 text-red-300";
  return "bg-zinc-800 text-zinc-300";
}

export type NewsSentimentFilter = "all" | "bullish" | "bearish" | "neutral";
export type NewsBadgeFilter = "all" | "breaking" | "trending" | "fresh";

export function normalizeHeadline(headline: string): string {
  return headline.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isBreakingNews(options: {
  publishedAt: string | null;
  sentiment: number | null;
  tags: string[];
  nowMs?: number;
}): boolean {
  const { publishedAt, sentiment, tags, nowMs = Date.now() } = options;
  if (!publishedAt) return false;
  const age = nowMs - new Date(publishedAt).getTime();
  if (Number.isNaN(age) || age < 0 || age > NEWS_BREAKING_WINDOW_MS) return false;
  const highImpact =
    (sentiment != null && Math.abs(sentiment) >= 0.3) ||
    tags.some((tag) => BREAKING_TAGS.has(tag));
  return highImpact;
}

export function isFreshNews(options: {
  publishedAt: string | null;
  isBreaking: boolean;
  nowMs?: number;
}): boolean {
  const { publishedAt, isBreaking, nowMs = Date.now() } = options;
  if (isBreaking || !publishedAt) return false;
  const age = nowMs - new Date(publishedAt).getTime();
  if (Number.isNaN(age) || age < 0) return false;
  return age <= NEWS_FRESH_WINDOW_MS;
}

export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Map DB rows into feed items with breaking/fresh/trending badges. */
export function buildNewsFeedItems(
  rows: MarketNewsRow[],
  nowMs = Date.now(),
): NewsFeedItem[] {
  const headlineCounts = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeHeadline(row.headline);
    headlineCounts.set(key, (headlineCounts.get(key) ?? 0) + 1);
  }

  const items = rows.map((row) => {
    const publishedAt = row.published_at;
    const tags = row.tags ?? [];
    const sentiment = row.sentiment;
    const relatedSymbols = row.related_symbols ?? [];
    const breaking = isBreakingNews({
      publishedAt,
      sentiment,
      tags,
      nowMs,
    });
    const multiHeadline = (headlineCounts.get(normalizeHeadline(row.headline)) ?? 0) >= 2;
    const multiRelated = relatedSymbols.length >= 2;
    const highSentiment = sentiment != null && Math.abs(sentiment) >= 0.35;
    const rawUrl = row.url?.trim() || null;

    return {
      id: String(row.id),
      headline: row.headline,
      summary: row.summary?.trim() || null,
      url: isSafeHttpUrl(rawUrl) ? rawUrl : null,
      source: row.source?.trim() || null,
      publishedAt,
      relatedSymbols,
      sentiment,
      tags,
      isBreaking: breaking,
      isFresh: isFreshNews({ publishedAt, isBreaking: breaking, nowMs }),
      isTrending: multiHeadline || highSentiment || multiRelated,
    } satisfies NewsFeedItem;
  });

  return items.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function filterNewsFeedItems(
  items: NewsFeedItem[],
  options: {
    source?: string;
    relatedSymbol?: string;
    sentiment?: NewsSentimentFilter;
    tag?: string;
    badge?: NewsBadgeFilter;
  } = {},
): NewsFeedItem[] {
  const {
    source,
    relatedSymbol,
    sentiment = "all",
    tag,
    badge = "all",
  } = options;

  return items.filter((item) => {
    if (source && item.source !== source) return false;
    if (relatedSymbol && !item.relatedSymbols.includes(relatedSymbol)) return false;
    if (tag && !item.tags.includes(tag)) return false;
    if (sentiment !== "all") {
      if (item.sentiment == null) return false;
      if (sentimentLabel(item.sentiment) !== sentiment) return false;
    }
    if (badge === "breaking" && !item.isBreaking) return false;
    if (badge === "trending" && !item.isTrending) return false;
    if (badge === "fresh" && !item.isFresh) return false;
    return true;
  });
}
