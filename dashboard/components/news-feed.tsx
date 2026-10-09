"use client";

import { ExternalLink } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchMarketNews } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  buildNewsFeedItems,
  filterNewsFeedItems,
  sentimentClass,
  sentimentLabel,
  type NewsBadgeFilter,
  type NewsSentimentFilter,
} from "@/lib/news-feed";
import type { MarketNewsRow } from "@/lib/types/database";
import { formatDateTime } from "@/lib/utils";

const NEWS_LIMIT = 100;

export function NewsFeed({ articles }: { articles: MarketNewsRow[] }) {
  const [sourceFilter, setSourceFilter] = useState("");
  const [relatedFilter, setRelatedFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<NewsSentimentFilter>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [badgeFilter, setBadgeFilter] = useState<NewsBadgeFilter>("all");

  const loadNews = useCallback(() => fetchMarketNews(NEWS_LIMIT), []);
  const liveArticles = useLiveQuery(articles, loadNews, ["market_news"], undefined, {
    skipInitialFetch: true,
  });

  const newsItems = useMemo(
    () => buildNewsFeedItems(liveArticles),
    [liveArticles],
  );

  const sources = useMemo(
    () =>
      [...new Set(newsItems.map((item) => item.source).filter(Boolean) as string[])].sort(),
    [newsItems],
  );

  const relatedSymbols = useMemo(
    () =>
      [...new Set(newsItems.flatMap((item) => item.relatedSymbols))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [newsItems],
  );

  const tags = useMemo(
    () =>
      [...new Set(newsItems.flatMap((item) => item.tags))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [newsItems],
  );

  const activeSourceFilter =
    sourceFilter && sources.includes(sourceFilter) ? sourceFilter : "";
  const activeRelatedFilter =
    relatedFilter && relatedSymbols.includes(relatedFilter) ? relatedFilter : "";
  const activeTagFilter = tagFilter && tags.includes(tagFilter) ? tagFilter : "";

  const filtered = useMemo(
    () =>
      filterNewsFeedItems(newsItems, {
        source: activeSourceFilter || undefined,
        relatedSymbol: activeRelatedFilter || undefined,
        sentiment: sentimentFilter,
        tag: activeTagFilter || undefined,
        badge: badgeFilter,
      }),
    [
      newsItems,
      activeSourceFilter,
      activeRelatedFilter,
      sentimentFilter,
      activeTagFilter,
      badgeFilter,
    ],
  );

  return (
    <Card>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <CardTitle>Market news</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <select
            value={badgeFilter}
            onChange={(e) => setBadgeFilter(e.target.value as NewsBadgeFilter)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
            aria-label="Filter by badge"
          >
            <option value="all">All headlines</option>
            <option value="breaking">Breaking</option>
            <option value="fresh">Fresh</option>
            <option value="trending">Trending</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
            aria-label="Filter by source"
          >
            <option value="">All sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <select
            value={relatedFilter}
            onChange={(e) => setRelatedFilter(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
            aria-label="Filter by related symbol"
          >
            <option value="">All tickers</option>
            {relatedSymbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
          <select
            value={sentimentFilter}
            onChange={(e) =>
              setSentimentFilter(e.target.value as NewsSentimentFilter)
            }
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
            aria-label="Filter by sentiment"
          >
            <option value="all">All sentiment</option>
            <option value="bullish">Bullish</option>
            <option value="neutral">Neutral</option>
            <option value="bearish">Bearish</option>
          </select>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      </div>

      {newsItems.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No market news yet. Headlines appear once the trader refreshes Finnhub
          general news.
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No headlines match these filters</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800/80">
          {filtered.map((item) => {
            const hasSentimentSignal =
              item.sentiment != null && Math.abs(item.sentiment) > 0.1;

            return (
              <li key={item.id} className="py-4 first:pt-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1.5 text-base font-medium leading-snug text-zinc-100 hover:text-emerald-300"
                      >
                        <span>{item.headline}</span>
                        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      </a>
                    ) : (
                      <p className="text-base font-medium leading-snug text-zinc-100">
                        {item.headline}
                      </p>
                    )}
                    {item.summary && (
                      <p className="line-clamp-2 text-sm leading-snug text-zinc-500">
                        {item.summary}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      {item.source && (
                        <button
                          type="button"
                          onClick={() => setSourceFilter(item.source!)}
                          className="font-medium text-zinc-300 hover:text-emerald-300"
                        >
                          {item.source}
                        </button>
                      )}
                      <span>{formatDateTime(item.publishedAt)}</span>
                    </div>
                    {(item.isBreaking ||
                      item.isFresh ||
                      item.isTrending ||
                      hasSentimentSignal ||
                      item.tags.length > 0 ||
                      item.relatedSymbols.length > 0) && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {item.isBreaking && (
                          <Badge className="bg-red-950 text-red-300">Breaking</Badge>
                        )}
                        {item.isFresh && (
                          <Badge className="bg-sky-950 text-sky-300">Fresh</Badge>
                        )}
                        {item.isTrending && (
                          <Badge className="bg-violet-950 text-violet-300">
                            Trending
                          </Badge>
                        )}
                        {item.sentiment != null && hasSentimentSignal && (
                          <Badge
                            className={sentimentClass(item.sentiment)}
                            title="Rule-based score (−1 bearish to +1 bullish)"
                          >
                            {sentimentLabel(item.sentiment)}{" "}
                            {item.sentiment.toFixed(2)}
                          </Badge>
                        )}
                        {item.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setTagFilter(tag)}
                          >
                            <Badge className="border border-zinc-700 bg-transparent px-1.5 py-0 text-[10px] text-zinc-500 hover:border-zinc-500 hover:text-zinc-300">
                              {tag}
                            </Badge>
                          </button>
                        ))}
                        {item.relatedSymbols.map((symbol) => (
                          <button
                            key={symbol}
                            type="button"
                            onClick={() => setRelatedFilter(symbol)}
                          >
                            <Badge className="border border-zinc-700 bg-zinc-900/60 px-1.5 py-0 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
                              {symbol}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
