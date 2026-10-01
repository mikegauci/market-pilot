import type { MarketSnapshot, Prediction } from "@/lib/types/database";

export function mapLatestPredictionRpcRows(data: unknown): Prediction[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row.id),
        symbol: String(row.symbol),
        timestamp: String(row.timestamp),
        price: Number(row.price),
        buy_probability: Number(row.buy_probability),
        hold_probability: Number(row.hold_probability),
        sell_probability: Number(row.sell_probability),
        trade_created: Boolean(row.trade_created),
        trade_skip_reason: (row.trade_skip_reason as string | null) ?? null,
        created_at: String(row.created_at),
        market_snapshot: (row.market_snapshot as MarketSnapshot | null) ?? null,
      } satisfies Prediction;
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

type FeedRow = Record<string, unknown> & {
  id: string;
  symbol: string;
  timestamp: string;
  price: number;
  buy_probability: number;
  hold_probability: number;
  sell_probability: number;
  trade_created: boolean;
  trade_skip_reason?: string | null;
  created_at: string;
  news_sentiment?: number | null;
  news_top_headline?: string | null;
  news_tags?: string[] | null;
  market_snapshot?: MarketSnapshot | null;
};

function newsSnapshotFromFeedRow(row: FeedRow): MarketSnapshot | null {
  const sentiment = row.news_sentiment;
  const headline = row.news_top_headline;
  const tags = row.news_tags;
  if (
    sentiment == null &&
    (headline == null || headline === "") &&
    (tags == null || tags.length === 0)
  ) {
    return null;
  }
  return {
    news_sentiment: sentiment ?? null,
    news_top_headline: headline ?? null,
    news_tags: tags ?? null,
  };
}

/** Merge JSON news aliases from a slim feed select into `Prediction.market_snapshot`. */
export function normalizePredictionFeedRows(rows: unknown[]): Prediction[] {
  return rows.map((raw) => {
    const row = raw as FeedRow;
    const newsOnly = newsSnapshotFromFeedRow(row);
    const snapshot =
      row.market_snapshot ??
      (newsOnly && Object.keys(newsOnly).length > 0 ? newsOnly : null);
    return {
      id: row.id,
      symbol: row.symbol,
      timestamp: row.timestamp,
      price: Number(row.price),
      buy_probability: Number(row.buy_probability),
      hold_probability: Number(row.hold_probability),
      sell_probability: Number(row.sell_probability),
      trade_created: Boolean(row.trade_created),
      trade_skip_reason: row.trade_skip_reason ?? null,
      created_at: row.created_at,
      market_snapshot: snapshot,
    };
  });
}
