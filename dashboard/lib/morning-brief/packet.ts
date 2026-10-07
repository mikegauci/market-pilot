import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { traderBuiltInGatesForPacket } from "@/lib/trader-built-in-gates";
import type { MarketNewsRow, Settings } from "@/lib/types/database";

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
  gates: ReturnType<typeof traderBuiltInGatesForPacket> & {
    minimum_jev_confidence_pct: number;
    min_volume_ratio: number;
    min_share_price: number;
    max_open_positions: number;
    confirmation_cycles: number;
    confirmation_seconds: number;
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
  const settings = input.settings;
  const builtIn = traderBuiltInGatesForPacket(settings.entry_ema_gate, {
    max_rsi: settings.max_rsi,
    max_spread_pct: settings.max_spread_pct,
  });
  const now = input.now ?? new Date();
  const windowStart = now.getTime() - MORNING_BRIEF_WINDOW_HOURS * 60 * 60 * 1000;
  const watchlist = resolveEffectiveWatchlist(input.settings);
  const watchlistSet = new Set(watchlist);

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
          .filter((symbol) => watchlistSet.has(symbol)),
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
      "Use only this packet. If headlines is empty, say there is no fresh company news and leave names_to_watch empty. Do not invent headlines, prices, or trades. Percents are already in percent (85 means 85%). spread max is percent of price (0.15 means 0.15%). A gate of 0 is off. names_to_watch must use symbols on the effective watchlist only.",
    generated_at: now.toISOString(),
    window_hours: MORNING_BRIEF_WINDOW_HOURS,
    fresh_headline_count: headlines.length,
    watchlist: watchlist.map((symbol) => ({
      symbol,
      pinned: false,
      locked: false,
      jev_buy_pct: null,
    })),
    gates: {
      ...builtIn,
      minimum_jev_confidence_pct: percentPoints(input.settings.minimum_jev_confidence),
      min_volume_ratio: input.settings.min_volume_ratio,
      min_share_price: input.settings.min_share_price,
      max_open_positions: input.settings.max_open_positions,
      confirmation_cycles: input.settings.confirmation_cycles,
      confirmation_seconds: input.settings.confirmation_seconds,
      gates_note:
        "Confidence, volume, share price, max positions, confirmation, RSI, spread, and EMA come from current settings. News sentiment and news tags still use trader env defaults.",
    },
    headlines,
  };
}
