import { createClient } from "@/lib/supabase/client";
import type {
  PortfolioSnapshot,
  Position,
  Prediction,
  SymbolBar,
  Trade,
  TradeCommand,
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
