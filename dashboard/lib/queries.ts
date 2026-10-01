import { fetchActiveIbkrAccountId } from "@/lib/active-ibkr-account";
import { filterTradesByActiveIbkrAccount } from "@/lib/ibkr-trade-scope";
import { normalizeSettings } from "@/lib/normalize-settings";
import { createClient } from "@/lib/supabase/server";
import type {
  BotStatus,
  EmUniverseRow,
  MarketNewsRow,
  IbkrAccountProfile,
  PortfolioSnapshot,
  Position,
  Prediction,
  Settings,
  SymbolBar,
  Trade,
  TradeCommand,
  WatchlistScreenerHistory,
} from "@/lib/types/database";

export async function getBotStatus(): Promise<BotStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("bot_status").select("*").eq("id", 1).single();
  return data as BotStatus | null;
}

export async function getSettings(): Promise<Settings | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("*").eq("id", 1).single();
  return normalizeSettings(data as Settings | null);
}

export async function getIbkrAccountProfile(
  accountId: string,
): Promise<IbkrAccountProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ibkr_account_profiles")
    .select("*")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();
  return data as IbkrAccountProfile | null;
}

export async function getLatestPortfolio(): Promise<PortfolioSnapshot | null> {
  const supabase = await createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return null;
  }
  const { data } = await supabase
    .from("portfolio_history")
    .select("*")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PortfolioSnapshot | null;
}

export async function getPortfolioHistory(limit = 5000): Promise<PortfolioSnapshot[]> {
  const supabase = await createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const { data } = await supabase
    .from("portfolio_history")
    .select("*")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as PortfolioSnapshot[];
  rows.reverse();
  return rows;
}

export async function getClosedTrades(): Promise<Trade[]> {
  const supabase = await createClient();
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
  const { data } = await scoped;
  return (data ?? []) as Trade[];
}

export async function getAnalyticsPredictions(limit = 2000): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("predictions")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);
  return (data ?? []) as Prediction[];
}

export async function getLatestPredictionsBySymbol(limit = 500): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("predictions")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);
  const seen = new Set<string>();
  const latest: Prediction[] = [];
  for (const row of (data ?? []) as Prediction[]) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    latest.push(row);
  }
  return latest.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function getScreenerHistory(limit = 10): Promise<WatchlistScreenerHistory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlist_screener_history")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as WatchlistScreenerHistory[];
}

export async function getPositions(): Promise<Position[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("positions").select("*").order("symbol");
  return (data ?? []) as Position[];
}

export async function getOpenTrades(): Promise<Trade[]> {
  const supabase = await createClient();
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
  const { data } = await scoped;
  return (data ?? []) as Trade[];
}

export async function getActiveTradeCommands(): Promise<TradeCommand[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("trade_commands")
    .select("*")
    .in("status", ["pending", "processing", "failed"])
    .order("requested_at", { ascending: false });
  return (data ?? []) as TradeCommand[];
}

export async function getRecentTrades(limit = 10): Promise<Trade[]> {
  const supabase = await createClient();
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
  const { data } = await scoped;
  return (data ?? []) as Trade[];
}

export async function getAllTrades(status?: "open" | "closed" | "all"): Promise<Trade[]> {
  const supabase = await createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  let query = supabase
    .from("trades")
    .select("*")
    .order("entry_time", { ascending: false })
    .limit(200);
  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  const scoped = await filterTradesByActiveIbkrAccount(supabase, accountId, query);
  const { data } = await scoped;
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

export async function getMarketNews(limit = 100): Promise<MarketNewsRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("market_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as MarketNewsRow[];
}

export async function getEmUniverseStats(): Promise<{
  count: number;
  tradableCount: number;
  topHoldings: EmUniverseRow[];
}> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("em_universe")
    .select("*", { count: "exact", head: true });
  const { count: tradableCount } = await supabase
    .from("em_universe")
    .select("*", { count: "exact", head: true })
    .eq("tradable", true);
  const { data } = await supabase
    .from("em_universe")
    .select("symbol, name, source_etfs, weight_bps, country, tradable, updated_at")
    .eq("tradable", true)
    .order("weight_bps", { ascending: false })
    .limit(20);

  return {
    count: count ?? 0,
    tradableCount: tradableCount ?? 0,
    topHoldings: (data ?? []) as EmUniverseRow[],
  };
}

export async function getTradedPredictions(limit = 10): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("predictions")
    .select("*")
    .eq("trade_created", true)
    .order("timestamp", { ascending: false })
    .limit(limit);
  return (data ?? []) as Prediction[];
}

export async function getSymbolBars(
  symbol: string,
  barSize = "5 mins",
  limit = 500,
): Promise<SymbolBar[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("symbol_bars")
    .select("*")
    .eq("symbol", symbol.toUpperCase())
    .eq("bar_size", barSize)
    .order("ts", { ascending: false })
    .limit(limit);
  const bars = (data ?? []) as SymbolBar[];
  bars.reverse();
  return bars;
}
