import { createClient } from "@/lib/supabase/client";
import type {
  MarketNewsRow,
  PortfolioSnapshot,
  Position,
  Prediction,
  Settings,
  SignalForwardReturn,
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
    .select("*")
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
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("status", "open")
    .order("entry_time", { ascending: false });
  if (error) {
    logFetchError("trades", error.message);
    return [];
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
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return (data ?? []) as Trade[];
}

export async function fetchAllTrades(): Promise<Trade[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(200);
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return (data ?? []) as Trade[];
}

export async function fetchLatestPortfolio(): Promise<PortfolioSnapshot | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
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
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
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
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("status", "closed")
    .order("exit_time", { ascending: false })
    .limit(500);
  if (error) {
    logFetchError("trades", error.message);
    return [];
  }
  return (data ?? []) as Trade[];
}

export async function fetchAnalyticsPredictions(limit = 2000): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  return (data ?? []) as Prediction[];
}

export async function fetchSignalForwardReturns(
  limit = 2000,
): Promise<SignalForwardReturn[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("signal_forward_returns")
    .select("*")
    .order("signal_at", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("signal_forward_returns", error.message);
    return [];
  }
  return (data ?? []) as SignalForwardReturn[];
}

export async function fetchLatestPredictionsBySymbol(limit = 500): Promise<Prediction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) {
    logFetchError("predictions", error.message);
    return [];
  }
  const seen = new Set<string>();
  const latest: Prediction[] = [];
  for (const row of (data ?? []) as Prediction[]) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    latest.push(row);
  }
  return latest.sort((a, b) => a.symbol.localeCompare(b.symbol));
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
