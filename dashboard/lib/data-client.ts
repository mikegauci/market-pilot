import { createClient } from "@/lib/supabase/client";
import type { PortfolioSnapshot, Position, Prediction, Trade } from "@/lib/types/database";

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

export async function fetchPortfolioHistory(hours = 24): Promise<PortfolioSnapshot[]> {
  const supabase = createClient();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("portfolio_history")
    .select("*")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true });
  if (error) {
    logFetchError("portfolio_history", error.message);
    return [];
  }
  return (data ?? []) as PortfolioSnapshot[];
}
