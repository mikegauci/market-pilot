import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import type { MarketNewsRow, Settings } from "@/lib/types/database";
import { parseWatchlistDismissed, parseWatchlistPins } from "@/lib/watchlist-curation";

/** Keep in sync with trader/strategy/config.py StrategyConfig defaults. */
const BUILT_IN_GATES = {
  max_spread_pct: 0.15,
  max_rsi: 70,
  min_news_sentiment: -0.3,
  require_price_above_ema20: true,
  news_block_tags: [
    "downgrade",
    "lawsuit",
    "sec_investigation",
    "guidance_cut",
    "layoffs",
  ],
  block_on_earnings: false,
} as const;

export const MORNING_BRIEF_WINDOW_HOURS = 18;
export const MORNING_BRIEF_HEADLINE_CAP = 24;

function percentPoints(decimal: number): number {
  return Math.round(decimal * 1000) / 10;
}

export type MorningBriefPacket = {
  note: string;
  generated_at: string;
  window_hours: number;
  fresh_headline_count: number;
  watchlist: {
    symbol: string;
    pinned: boolean;
    locked: boolean;
    jev_buy_pct: number | null;
  }[];
  dismissed: string[];
  gates: {
    minimum_jev_confidence_pct: number;
    min_volume_ratio: number;
    min_share_price: number;
    max_open_positions: number;
    confirmation_cycles: number;
    confirmation_seconds: number;
    max_spread_pct: number;
    max_rsi: number;
    min_news_sentiment: number;
    require_price_above_ema20: boolean;
    news_block_tags: string[];
    block_on_earnings: boolean;
    gates_note: string;
  };
  headlines: {
    symbols: string[];
    headline: string;
    published_at: string;
    sentiment: number | null;
    tags: string[];
  }[];
};

export function buildMorningBriefPacket(input: {
  settings: Settings;
  articles: MarketNewsRow[];
  now?: Date;
}): MorningBriefPacket {
  const now = input.now ?? new Date();
  const windowStart = now.getTime() - MORNING_BRIEF_WINDOW_HOURS * 60 * 60 * 1000;
  const pins = parseWatchlistPins(input.settings.watchlist_pins);
  const pinBySymbol = new Map(pins.map((pin) => [pin.symbol.toUpperCase(), pin]));
  const dismissed = parseWatchlistDismissed(input.settings.watchlist_dismissed);
  const watchlist = resolveEffectiveWatchlist(input.settings);
  const known = new Set<string>([...watchlist, ...dismissed, ...pinBySymbol.keys()]);
  const buyBySymbol = new Map(
    (input.settings.watchlist_jev_rankings ?? []).map((row) => [
      row.symbol.toUpperCase(),
      percentPoints(row.buy),
    ]),
  );

  const headlines: MorningBriefPacket["headlines"] = [];
  for (const article of input.articles) {
    if (headlines.length >= MORNING_BRIEF_HEADLINE_CAP) break;
    const publishedMs = new Date(article.published_at).getTime();
    if (!Number.isFinite(publishedMs) || publishedMs < windowStart) continue;
    const headline = article.headline?.trim();
    if (!headline) continue;
    const symbols = [
      ...new Set(
        (article.related_symbols ?? [])
          .map((symbol) => symbol.toUpperCase())
          .filter((symbol) => known.has(symbol)),
      ),
    ];
    if (symbols.length === 0) continue;
    headlines.push({
      symbols,
      headline: headline.slice(0, 200),
      published_at: article.published_at,
      sentiment:
        article.sentiment == null ? null : Math.round(article.sentiment * 100) / 100,
      tags: article.tags ?? [],
    });
  }

  return {
    note:
      "Use only this packet. If headlines is empty, say there is no fresh company news and leave names_to_watch empty. Do not invent headlines, prices, or trades. Percents are already in percent (85 means 85%). spread max is percent of price (0.15 means 0.15%). A gate of 0 is off.",
    generated_at: now.toISOString(),
    window_hours: MORNING_BRIEF_WINDOW_HOURS,
    fresh_headline_count: headlines.length,
    watchlist: watchlist.map((symbol) => {
      const pin = pinBySymbol.get(symbol);
      return {
        symbol,
        pinned: pin != null,
        locked: pin?.locked ?? false,
        jev_buy_pct: buyBySymbol.get(symbol) ?? null,
      };
    }),
    dismissed,
    gates: {
      minimum_jev_confidence_pct: percentPoints(input.settings.minimum_jev_confidence),
      min_volume_ratio: input.settings.min_volume_ratio,
      min_share_price: input.settings.min_share_price,
      max_open_positions: input.settings.max_open_positions,
      confirmation_cycles: input.settings.confirmation_cycles,
      confirmation_seconds: input.settings.confirmation_seconds,
      max_spread_pct: BUILT_IN_GATES.max_spread_pct,
      max_rsi: BUILT_IN_GATES.max_rsi,
      min_news_sentiment: BUILT_IN_GATES.min_news_sentiment,
      require_price_above_ema20: BUILT_IN_GATES.require_price_above_ema20,
      news_block_tags: [...BUILT_IN_GATES.news_block_tags],
      block_on_earnings: BUILT_IN_GATES.block_on_earnings,
      gates_note:
        "Confidence, volume, share price, max positions, and confirmation come from current settings. Spread, RSI, news sentiment, EMA, and news tags are the bot's built-in gates.",
    },
    headlines,
  };
}
