import { createClient } from "@/lib/supabase/server";
import type {
  BotStatus,
  PortfolioSnapshot,
  Position,
  Prediction,
  Settings,
  Trade,
} from "@/lib/types/database";

export async function getBotStatus(): Promise<BotStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("bot_status").select("*").eq("id", 1).single();
  return data as BotStatus | null;
}

export async function getSettings(): Promise<Settings | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("*").eq("id", 1).single();
  return data as Settings | null;
}

export async function getLatestPortfolio(): Promise<PortfolioSnapshot | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_history")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PortfolioSnapshot | null;
}

export async function getPortfolioHistory(hours = 24): Promise<PortfolioSnapshot[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("portfolio_history")
    .select("*")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true });
  return (data ?? []) as PortfolioSnapshot[];
}

export async function getPositions(): Promise<Position[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("positions").select("*").order("symbol");
  return (data ?? []) as Position[];
}

export async function getRecentTrades(limit = 10): Promise<Trade[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(limit);
  return (data ?? []) as Trade[];
}

export async function getAllTrades(status?: "open" | "closed" | "all"): Promise<Trade[]> {
  const supabase = await createClient();
  let query = supabase.from("trades").select("*").order("entry_time", { ascending: false });
  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  const { data } = await query.limit(200);
  return (data ?? []) as Trade[];
}

export async function getPredictions(limit = 50, symbol?: string): Promise<Prediction[]> {
  const supabase = await createClient();
  let query = supabase
    .from("predictions")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (symbol) {
    query = query.eq("symbol", symbol);
  }
  const { data } = await query;
  return (data ?? []) as Prediction[];
}
