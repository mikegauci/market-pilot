import { ANALYTICS_SKIP_REASON_LIMIT } from "@/lib/analytics-data";
import {
  normalizePredictionFeedRows,
} from "@/lib/prediction-feed-normalize";
import {
  PREDICTION_FEED_SELECT,
  PREDICTION_WITH_SNAPSHOT_COLUMNS,
} from "@/lib/prediction-columns";
import { tradingDayStartUtc } from "@/lib/market-hours";
import {
  readActivePositionCommands,
  readActiveTradeCommands,
  readAllTrades,
  readAnalyticsPredictions,
  readClosedTrades,
  readLatestPredictionsBySymbol,
  readLatestPortfolio,
  readMarketNews,
  readOpenTrades,
  readPortfolioHistory,
  readPositions,
  readPredictionFeed,
  readSettings,
  readSymbolBars,
  readTradedPredictions,
  readTradesForTradingDay,
} from "@/lib/supabase/data-reads";
import { createClient } from "@/lib/supabase/client";
import type {
  MarketNewsRow,
  PortfolioSnapshot,
  Position,
  Prediction,
  Settings,
  SymbolBar,
  Trade,
  PositionCommand,
  TradeCommand,
} from "@/lib/types/database";

function logFetchError(table: string, message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`${table} fetch failed:`, message);
  }
}

export async function fetchPositions(): Promise<Position[]> {
  const supabase = createClient();
  const { data, error } = await readPositions(supabase);
  if (error) {
    logFetchError("positions", error.message);
    return [];
  }
  return data;
}

export async function fetchPredictions(limit = 50, symbol?: string): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await readPredictionFeed(supabase, limit, symbol);
  if (error) {
    logFetchError("predictions", error.message);
    throw new Error(error.message);
  }
  return data;
}

export async function fetchPredictionWithSnapshot(
  id: string,
): Promise<Prediction | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("predictions")
    .select(PREDICTION_WITH_SNAPSHOT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logFetchError("predictions", error.message);
    return null;
  }
  return (data ?? null) as Prediction | null;
}

export async function fetchMarketNews(limit = 100): Promise<MarketNewsRow[]> {
  const supabase = createClient();
  const { data, error } = await readMarketNews(supabase, limit);
  if (error) {
    logFetchError("market_news", error.message);
    return [];
  }
  return data;
}

export async function fetchTradedPredictions(limit = 10): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await readTradedPredictions(supabase, limit);
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return data;
}

export async function fetchOpenTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const { data, error } = await readOpenTrades(supabase);
  if (error) {
    logFetchError("trades", error.message);
    throw new Error(error.message);
  }
  return data;
}

export async function fetchActiveTradeCommands(): Promise<TradeCommand[]> {
  const supabase = createClient();
  const { data, error } = await readActiveTradeCommands(supabase);
  if (error) {
    logFetchError("trade_commands", error.message);
    return [];
  }
  return data;
}

export async function fetchActivePositionCommands(): Promise<PositionCommand[]> {
  const supabase = createClient();
  const { data, error } = await readActivePositionCommands(supabase);
  if (error) {
    logFetchError("position_commands", error.message);
    return [];
  }
  return data;
}

export async function fetchTradesForTradingDay(
  dayStartIso = tradingDayStartUtc(),
): Promise<Trade[]> {
  const supabase = createClient();
  const { data, error } = await readTradesForTradingDay(supabase, dayStartIso);
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return data;
}

export async function fetchAllTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const { data, error } = await readAllTrades(supabase);
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return data;
}

export async function fetchLatestPortfolio(): Promise<PortfolioSnapshot | null> {
  const supabase = createClient();
  const { data, error } = await readLatestPortfolio(supabase);
  if (error) {
    logFetchError("portfolio_history", error.message);
    return null;
  }
  return data;
}

export async function fetchPortfolioHistory(limit = 5000): Promise<PortfolioSnapshot[]> {
  const supabase = createClient();
  const { data, error } = await readPortfolioHistory(supabase, limit);
  if (error) {
    logFetchError("portfolio_history", error.message);
    return [];
  }
  return data;
}

export async function fetchClosedTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const { data, error } = await readClosedTrades(supabase);
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return data;
}

export async function fetchAnalyticsPredictions(
  limit = ANALYTICS_SKIP_REASON_LIMIT,
): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await readAnalyticsPredictions(supabase, limit);
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return data;
}

/** Recent prediction rows — same data as the predictions feed, scoped to a short window. */
export async function fetchRecentPredictions(
  windowMinutes = 2,
  limit = 30,
): Promise<Prediction[]> {
  const supabase = createClient();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("predictions")
    .select(PREDICTION_FEED_SELECT)
    .gte("timestamp", since)
    .order("buy_probability", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("predictions", error.message);
    throw new Error(error.message);
  }
  return normalizePredictionFeedRows(data ?? []);
}

export async function fetchLatestPredictionsBySymbol(
  limit?: number,
): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await readLatestPredictionsBySymbol(supabase, limit);
  if (error) {
    logFetchError("predictions", error.message);
    throw new Error(error.message);
  }
  return data;
}

export async function fetchSettings(): Promise<Settings | null> {
  const supabase = createClient();
  const { data, error } = await readSettings(supabase);
  if (error) {
    logFetchError("settings", error.message);
    return null;
  }
  return data;
}

export async function fetchSymbolBars(
  symbol: string,
  barSize = "5 mins",
  limit = 500,
): Promise<SymbolBar[]> {
  const supabase = createClient();
  const { data, error } = await readSymbolBars(supabase, symbol, barSize, limit);
  if (error) {
    logFetchError("symbol_bars", error.message);
    return [];
  }
  return data;
}
