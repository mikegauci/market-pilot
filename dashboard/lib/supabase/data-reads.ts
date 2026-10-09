import {
  ANALYTICS_SKIP_LOOKBACK_HOURS,
  ANALYTICS_SKIP_PREDICTION_COLUMNS,
  ANALYTICS_SKIP_REASON_LIMIT,
  LATEST_PREDICTIONS_PER_SYMBOL_LIMIT,
} from "@/lib/analytics-data";
import { filterTradesByActiveIbkrAccount } from "@/lib/ibkr-trade-scope";
import { resolveTradeAccountScope } from "@/lib/trade-account-scope";
import { tradingDayStartUtc } from "@/lib/market-hours";
import { normalizeSettings } from "@/lib/normalize-settings";
import {
  normalizePredictionFeedRows,
  mapLatestPredictionRpcRows,
} from "@/lib/prediction-feed-normalize";
import { PREDICTION_FEED_COLUMNS } from "@/lib/prediction-columns";
import type { PredictionFeedFilters } from "@/lib/prediction-feed";
import { tradingDayTradesOrFilter } from "@/lib/trading-day-trades";
import type {
  MarketNewsRow,
  PortfolioSnapshot,
  Position,
  EntryCommand,
  PositionCommand,
  Prediction,
  Settings,
  SymbolBar,
  Trade,
  TradeCommand,
} from "@/lib/types/database";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type SupabaseRead<T> = { data: T; error: PostgrestError | null };

export async function readSettings(
  supabase: SupabaseClient,
): Promise<SupabaseRead<Settings | null>> {
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
  return { data: normalizeSettings(data as Settings | null), error };
}

export async function readPositions(
  supabase: SupabaseClient,
): Promise<SupabaseRead<Position[]>> {
  const { data, error } = await supabase.from("positions").select("*").order("symbol");
  return { data: (data ?? []) as Position[], error };
}

export async function readOpenTrades(supabase: SupabaseClient): Promise<SupabaseRead<Trade[]>> {
  const { accountId, includeLegacy } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    return { data: [], error: null };
  }
  const query = supabase
    .from("trades")
    .select("*")
    .eq("status", "open")
    .order("entry_time", { ascending: false });
  const scoped = await filterTradesByActiveIbkrAccount(
    supabase,
    accountId,
    query,
    includeLegacy,
  );
  const { data, error } = await scoped;
  return { data: (data ?? []) as Trade[], error };
}

export async function readClosedTrades(
  supabase: SupabaseClient,
): Promise<SupabaseRead<Trade[]>> {
  const { accountId, includeLegacy } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    return { data: [], error: null };
  }
  const query = supabase
    .from("trades")
    .select("*")
    .eq("status", "closed")
    .order("exit_time", { ascending: false })
    .limit(500);
  const scoped = await filterTradesByActiveIbkrAccount(
    supabase,
    accountId,
    query,
    includeLegacy,
  );
  const { data, error } = await scoped;
  return { data: (data ?? []) as Trade[], error };
}

export async function readTradesForTradingDay(
  supabase: SupabaseClient,
  dayStartIso: string = tradingDayStartUtc(),
): Promise<SupabaseRead<Trade[]>> {
  const { accountId, includeLegacy } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    return { data: [], error: null };
  }
  const query = supabase
    .from("trades")
    .select("*")
    .or(tradingDayTradesOrFilter(dayStartIso))
    .order("entry_time", { ascending: false })
    .limit(500);
  const scoped = await filterTradesByActiveIbkrAccount(
    supabase,
    accountId,
    query,
    includeLegacy,
  );
  const { data, error } = await scoped;
  return { data: (data ?? []) as Trade[], error };
}

export async function readAllTrades(
  supabase: SupabaseClient,
  status?: "open" | "closed" | "all",
): Promise<SupabaseRead<Trade[]>> {
  const { accountId, includeLegacy } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    return { data: [], error: null };
  }
  let query = supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(200);
  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  const scoped = await filterTradesByActiveIbkrAccount(
    supabase,
    accountId,
    query,
    includeLegacy,
  );
  const { data, error } = await scoped;
  return { data: (data ?? []) as Trade[], error };
}

export async function readActiveTradeCommands(
  supabase: SupabaseClient,
): Promise<SupabaseRead<TradeCommand[]>> {
  const { data, error } = await supabase
    .from("trade_commands")
    .select("*")
    .in("status", ["pending", "processing", "failed"])
    .order("requested_at", { ascending: false });
  return { data: (data ?? []) as TradeCommand[], error };
}

export async function readActivePositionCommands(
  supabase: SupabaseClient,
): Promise<SupabaseRead<PositionCommand[]>> {
  const { data, error } = await supabase
    .from("position_commands")
    .select("*")
    .in("status", ["pending", "processing", "failed"])
    .order("requested_at", { ascending: false });
  return { data: (data ?? []) as PositionCommand[], error };
}

export async function readActiveEntryCommands(
  supabase: SupabaseClient,
): Promise<SupabaseRead<EntryCommand[]>> {
  const { data, error } = await supabase
    .from("entry_commands")
    .select("*")
    .in("status", ["pending", "processing", "failed"])
    .order("requested_at", { ascending: false });
  return { data: (data ?? []) as EntryCommand[], error };
}

export async function readLatestPortfolio(
  supabase: SupabaseClient,
): Promise<SupabaseRead<PortfolioSnapshot | null>> {
  const { accountId } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    return { data: null, error: null };
  }
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: (data ?? null) as PortfolioSnapshot | null, error };
}

export async function readPortfolioHistory(
  supabase: SupabaseClient,
  limit = 5000,
): Promise<SupabaseRead<PortfolioSnapshot[]>> {
  const { accountId } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    return { data: [], error: null };
  }
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as PortfolioSnapshot[];
  rows.reverse();
  return { data: rows, error };
}

export async function readMarketNews(
  supabase: SupabaseClient,
  limit = 100,
): Promise<SupabaseRead<MarketNewsRow[]>> {
  const { data, error } = await supabase
    .from("market_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(limit);
  return { data: (data ?? []) as MarketNewsRow[], error };
}

export async function readSymbolBars(
  supabase: SupabaseClient,
  symbol: string,
  barSize = "5 mins",
  limit = 500,
): Promise<SupabaseRead<SymbolBar[]>> {
  const { data, error } = await supabase
    .from("symbol_bars")
    .select("*")
    .eq("symbol", symbol.toUpperCase())
    .eq("bar_size", barSize)
    .order("ts", { ascending: false })
    .limit(limit);
  const bars = (data ?? []) as SymbolBar[];
  bars.reverse();
  return { data: bars, error };
}

export async function readAnalyticsPredictions(
  supabase: SupabaseClient,
  limit = ANALYTICS_SKIP_REASON_LIMIT,
  lookbackHours = ANALYTICS_SKIP_LOOKBACK_HOURS,
): Promise<SupabaseRead<Prediction[]>> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("predictions")
    .select(ANALYTICS_SKIP_PREDICTION_COLUMNS)
    .gte("timestamp", since)
    .order("timestamp", { ascending: false })
    .limit(limit);
  return { data: (data ?? []) as Prediction[], error };
}

async function queryPredictionFeed(
  supabase: SupabaseClient,
  filters: PredictionFeedFilters,
): Promise<SupabaseRead<Prediction[]>> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  let query = supabase.from("predictions").select(PREDICTION_FEED_COLUMNS);
  if (filters.sinceIso) {
    query = query.gte("timestamp", filters.sinceIso);
  }
  if (filters.symbol) {
    query = query.eq("symbol", filters.symbol);
  }
  const { data, error } = await query
    .order("timestamp", { ascending: false })
    .range(offset, offset + limit - 1);
  return { data: normalizePredictionFeedRows(data ?? []), error };
}

export type PredictionFeedPageLoad = {
  predictions: Prediction[];
  totalCount: number;
};

async function countPredictionFeed(
  supabase: SupabaseClient,
  filters: Pick<PredictionFeedFilters, "symbol" | "sinceIso">,
): Promise<{ count: number; error: PostgrestError | null }> {
  let query = supabase.from("predictions").select("*", { count: "exact", head: true });
  if (filters.sinceIso) {
    query = query.gte("timestamp", filters.sinceIso);
  }
  if (filters.symbol) {
    query = query.eq("symbol", filters.symbol);
  }
  const { count, error } = await query;
  return { count: count ?? 0, error };
}

/** Paginated feed for the predictions table (plain columns; news loads on row expand). */
export async function readPredictionFeedPage(
  supabase: SupabaseClient,
  filters: PredictionFeedFilters,
): Promise<SupabaseRead<PredictionFeedPageLoad>> {
  const first = await queryPredictionFeed(supabase, filters);
  const countResult = await countPredictionFeed(supabase, filters);
  if (!first.error && !countResult.error) {
    return {
      data: { predictions: first.data, totalCount: countResult.count },
      error: null,
    };
  }
  const retry = await queryPredictionFeed(supabase, filters);
  const retryCount = await countPredictionFeed(supabase, filters);
  if (!retry.error && !retryCount.error) {
    return {
      data: { predictions: retry.data, totalCount: retryCount.count },
      error: null,
    };
  }
  return {
    data: { predictions: first.data, totalCount: countResult.count },
    error: first.error ?? countResult.error,
  };
}

/** Distinct symbols with predictions since `sinceIso` (for feed filter dropdown). */
export async function readPredictionFeedSymbols(
  supabase: SupabaseClient,
  sinceIso: string,
): Promise<SupabaseRead<string[]>> {
  const { data, error } = await supabase.rpc("list_prediction_feed_symbols", {
    p_since: sinceIso,
  });
  if (error) {
    return { data: [], error };
  }
  const symbols = (data ?? []).map((row: { symbol: string }) => row.symbol).filter(Boolean);
  return { data: symbols, error: null };
}

/** Page number (1-based) for a prediction id in timestamp-desc feed order. */
export async function readPredictionFeedPageForId(
  supabase: SupabaseClient,
  predictionId: string,
  pageSize: number,
  sinceIso: string,
  symbol?: string,
): Promise<SupabaseRead<number>> {
  const { data: row, error: rowError } = await supabase
    .from("predictions")
    .select("timestamp,symbol")
    .eq("id", predictionId)
    .maybeSingle();
  if (rowError) {
    return { data: 1, error: rowError };
  }
  if (!row) {
    return { data: 1, error: null };
  }
  if (symbol && row.symbol !== symbol) {
    return { data: 1, error: null };
  }
  let query = supabase
    .from("predictions")
    .select("*", { count: "exact", head: true })
    .gte("timestamp", sinceIso)
    .gt("timestamp", row.timestamp as string);
  if (symbol) {
    query = query.eq("symbol", symbol);
  }
  const { count, error } = await query;
  if (error) {
    return { data: 1, error };
  }
  const index = count ?? 0;
  return { data: Math.floor(index / pageSize) + 1, error: null };
}

/** Latest predictions for the feed — plain columns only (news loads on row expand). */
export async function readPredictionFeed(
  supabase: SupabaseClient,
  limit = 50,
  symbol?: string,
): Promise<SupabaseRead<Prediction[]>> {
  const { data, error } = await readPredictionFeedPage(supabase, { limit, offset: 0, symbol });
  return { data: data.predictions, error };
}

export async function readLatestPredictionsBySymbol(
  supabase: SupabaseClient,
  limit = LATEST_PREDICTIONS_PER_SYMBOL_LIMIT,
): Promise<SupabaseRead<Prediction[]>> {
  const { data, error } = await supabase.rpc("get_latest_predictions_per_symbol", {
    row_limit: limit,
  });
  if (error) {
    return { data: [], error };
  }
  return { data: mapLatestPredictionRpcRows(data), error: null };
}
