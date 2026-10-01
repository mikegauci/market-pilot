import {
  ANALYTICS_CALIBRATION_COLUMNS,
  ANALYTICS_CALIBRATION_LIMIT,
  ANALYTICS_CALIBRATION_LOOKBACK_DAYS,
  ANALYTICS_SKIP_LOOKBACK_HOURS,
  ANALYTICS_SKIP_PREDICTION_COLUMNS,
  ANALYTICS_SKIP_REASON_LIMIT,
} from "@/lib/analytics-data";
import {
  CalibrationFetchError,
  mapCalibrationRpcRows,
} from "@/lib/jev-calibration-rpc";
import {
  LATEST_PREDICTIONS_PER_SYMBOL_LIMIT,
} from "@/lib/analytics-data";
import {
  normalizePredictionFeedRows,
  mapLatestPredictionRpcRows,
} from "@/lib/prediction-feed-normalize";
import {
  PREDICTION_FEED_SELECT,
  PREDICTION_WITH_SNAPSHOT_COLUMNS,
} from "@/lib/prediction-columns";
import { fetchActiveIbkrAccountId } from "@/lib/active-ibkr-account";
import { filterTradesByActiveIbkrAccount } from "@/lib/ibkr-trade-scope";
import { createClient } from "@/lib/supabase/client";
import type {
  MarketNewsRow,
  PortfolioSnapshot,
  Position,
  Prediction,
  Settings,
  SymbolBar,
  Trade,
  TradeCommand,
  WatchlistScreenerHistory,
} from "@/lib/types/database";

function logFetchError(table: string, message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`${table} fetch failed:`, message);
  }
}

export async function fetchPositions(): Promise<Position[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("positions").select("*").order("symbol");
  if (error) {
    logFetchError("positions", error.message);
    return [];
  }
  return (data ?? []) as Position[];
}

export async function fetchPredictions(limit = 50, symbol?: string): Promise<Prediction[]> {
  const supabase = createClient();
  let query = supabase
    .from("predictions")
    .select(PREDICTION_FEED_SELECT)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (symbol) {
    query = query.eq("symbol", symbol);
  }
  const { data, error } = await query;
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return normalizePredictionFeedRows(data ?? []);
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

/** Aggregated calibration buckets (~5 rows) — preferred over row downloads. */
export async function fetchJevCalibrationBuckets(
  lookbackDays = ANALYTICS_CALIBRATION_LOOKBACK_DAYS,
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_jev_calibration_buckets", {
    lookback_days: lookbackDays,
  });
  if (error) {
    logFetchError("predictions_calibration", error.message);
    throw new CalibrationFetchError(error.message);
  }
  return mapCalibrationRpcRows(data);
}

/** Matured rows for Jev calibration — not the same as latest predictions feed. */
export async function fetchPredictionsForCalibration(
  limit = ANALYTICS_CALIBRATION_LIMIT,
): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("predictions")
    .select(ANALYTICS_CALIBRATION_COLUMNS)
    .not("return_15m_pct", "is", null)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("predictions_calibration", error.message);
    return [];
  }
  return (data ?? []) as Prediction[];
}

export async function fetchMarketNews(limit = 100): Promise<MarketNewsRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("market_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("market_news", error.message);
    return [];
  }
  return (data ?? []) as MarketNewsRow[];
}

export async function fetchTradedPredictions(limit = 10): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("trade_created", true)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return (data ?? []) as Prediction[];
}

export async function fetchOpenTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const query = supabase
    .from("trades")
    .select("*")
    .eq("status", "open")
    .order("entry_time", { ascending: false });
  const scoped = await filterTradesByActiveIbkrAccount(supabase, accountId, query);
  const { data, error } = await scoped;
  if (error) {
    logFetchError("trades", error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as Trade[];
}

export async function fetchActiveTradeCommands(): Promise<TradeCommand[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trade_commands")
    .select("*")
    .in("status", ["pending", "processing", "failed"])
    .order("requested_at", { ascending: false });
  if (error) {
    logFetchError("trade_commands", error.message);
    return [];
  }
  return (data ?? []) as TradeCommand[];
}

export async function fetchRecentTrades(limit = 10): Promise<Trade[]> {
  const supabase = createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const query = supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(limit);
  const scoped = await filterTradesByActiveIbkrAccount(supabase, accountId, query);
  const { data, error } = await scoped;
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return (data ?? []) as Trade[];
}

export async function fetchAllTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const query = supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(200);
  const scoped = await filterTradesByActiveIbkrAccount(supabase, accountId, query);
  const { data, error } = await scoped;
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return (data ?? []) as Trade[];
}

export async function fetchLatestPortfolio(): Promise<PortfolioSnapshot | null> {
  const supabase = createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return null;
  }
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logFetchError("portfolio_history", error.message);
    return null;
  }
  return data as PortfolioSnapshot | null;
}

export async function fetchPortfolioHistory(limit = 5000): Promise<PortfolioSnapshot[]> {
  const supabase = createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("portfolio_history", error.message);
    return [];
  }
  const rows = (data ?? []) as PortfolioSnapshot[];
  rows.reverse();
  return rows;
}

export async function fetchClosedTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const query = supabase
    .from("trades")
    .select("*")
    .eq("status", "closed")
    .order("exit_time", { ascending: false })
    .limit(500);
  const scoped = await filterTradesByActiveIbkrAccount(supabase, accountId, query);
  const { data, error } = await scoped;
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return (data ?? []) as Trade[];
}

export async function fetchAnalyticsPredictions(
  limit = ANALYTICS_SKIP_REASON_LIMIT,
): Promise<Prediction[]> {
  const supabase = createClient();
  const since = new Date(
    Date.now() - ANALYTICS_SKIP_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("predictions")
    .select(ANALYTICS_SKIP_PREDICTION_COLUMNS)
    .gte("timestamp", since)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return (data ?? []) as Prediction[];
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
    return [];
  }
  return normalizePredictionFeedRows(data ?? []);
}

export async function fetchLatestPredictionsBySymbol(
  limit = LATEST_PREDICTIONS_PER_SYMBOL_LIMIT,
): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_latest_predictions_per_symbol", {
    row_limit: limit,
  });
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return mapLatestPredictionRpcRows(data);
}

export async function fetchScreenerHistory(limit = 10): Promise<WatchlistScreenerHistory[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("watchlist_screener_history")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("watchlist_screener_history", error.message);
    return [];
  }
  return (data ?? []) as WatchlistScreenerHistory[];
}

export async function fetchSettings(): Promise<Settings | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
  if (error) {
    logFetchError("settings", error.message);
    return null;
  }
  return data as Settings;
}

export async function fetchSymbolBars(
  symbol: string,
  barSize = "5 mins",
  limit = 500,
): Promise<SymbolBar[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("symbol_bars")
    .select("*")
    .eq("symbol", symbol.toUpperCase())
    .eq("bar_size", barSize)
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("symbol_bars", error.message);
    return [];
  }
  const bars = (data ?? []) as SymbolBar[];
  bars.reverse();
  return bars;
}
