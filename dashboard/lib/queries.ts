import {
  ANALYTICS_CALIBRATION_LOOKBACK_DAYS,
  ANALYTICS_PORTFOLIO_HISTORY_LIMIT,
  ANALYTICS_SKIP_LOOKBACK_HOURS,
  ANALYTICS_SKIP_PREDICTION_COLUMNS,
  ANALYTICS_SKIP_REASON_LIMIT,
} from "@/lib/analytics-data";
import { LATEST_PREDICTIONS_PER_SYMBOL_LIMIT } from "@/lib/analytics-data";
import { mapCalibrationRpcRows } from "@/lib/jev-calibration-rpc";
import { mapLatestPredictionRpcRows } from "@/lib/prediction-feed-normalize";
import { fetchActiveIbkrAccountId } from "@/lib/active-ibkr-account";
import { filterTradesByActiveIbkrAccount } from "@/lib/ibkr-trade-scope";
import { normalizeSettings } from "@/lib/normalize-settings";
import { tradingDayStartUtc } from "@/lib/market-hours";
import { tradingDayTradesOrFilter } from "@/lib/trading-day-trades";
import { SESSION_BRIEF_FIRST_DATE } from "@/lib/session-brief/constants";
import {
  buildSessionBriefHistory,
  parseSessionBriefDays,
  type SessionBriefHistoryEntry,
} from "@/lib/session-brief/history";
import {
  parseSessionConditionMix,
  type SessionConditionMinutes,
} from "@/lib/session-brief/market-condition-mix";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import { createClient } from "@/lib/supabase/server";
import type {
  BotStatus,
  MarketNewsRow,
  IbkrAccountProfile,
  PortfolioSnapshot,
  Position,
  Prediction,
  Settings,
  SymbolBar,
  SessionBriefRow,
  Trade,
  TradeCommand,
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

export async function getAnalyticsPredictions(
  limit = ANALYTICS_SKIP_REASON_LIMIT,
  lookbackHours = ANALYTICS_SKIP_LOOKBACK_HOURS,
): Promise<Prediction[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("predictions")
    .select(ANALYTICS_SKIP_PREDICTION_COLUMNS)
    .gte("timestamp", since)
    .order("timestamp", { ascending: false })
    .limit(limit);
  return (data ?? []) as Prediction[];
}

export type SessionBriefHistoryLoad = {
  history: SessionBriefHistoryEntry[];
  loadError: string | null;
};

export async function getSessionBriefHistory(): Promise<SessionBriefHistoryLoad> {
  const supabase = await createClient();
  const [{ data: daysRaw, error: daysError }, { data: briefRows, error: briefsError }] =
    await Promise.all([
      supabase.rpc("list_prediction_session_dates", { p_since: SESSION_BRIEF_FIRST_DATE }),
      supabase.rpc("get_latest_session_briefs", { p_since: SESSION_BRIEF_FIRST_DATE }),
    ]);

  if (daysError) {
    return {
      history: [],
      loadError: daysError.message,
    };
  }
  if (briefsError) {
    return {
      history: [],
      loadError: briefsError.message,
    };
  }

  const days = parseSessionBriefDays(daysRaw);
  return {
    history: buildSessionBriefHistory(days, (briefRows ?? []) as SessionBriefRow[]),
    loadError: null,
  };
}

export type SessionConditionMixLoad = {
  rows: SessionConditionMinutes[];
  loadError: string | null;
};

export async function getSessionMarketConditionMix(): Promise<SessionConditionMixLoad> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_session_market_condition_mix", {
    p_since: SESSION_BRIEF_FIRST_DATE,
    p_headwind_floor: STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct,
  });
  if (error) {
    return { rows: [], loadError: error.message };
  }
  return { rows: parseSessionConditionMix(data), loadError: null };
}

export async function getLatestSessionBriefForUser(): Promise<SessionBriefRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("session_briefs")
    .select("*")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as SessionBriefRow;
}

export async function getJevCalibrationBuckets(
  lookbackDays = ANALYTICS_CALIBRATION_LOOKBACK_DAYS,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_jev_calibration_buckets", {
    lookback_days: lookbackDays,
  });
  if (error) {
    return { buckets: [], error: error.message };
  }
  return { buckets: mapCalibrationRpcRows(data), error: null };
}

export async function getLatestPredictionsBySymbol(
  limit = LATEST_PREDICTIONS_PER_SYMBOL_LIMIT,
): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_latest_predictions_per_symbol", {
    row_limit: limit,
  });
  if (error) {
    return [];
  }
  return mapLatestPredictionRpcRows(data);
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

/**
 * Overview trades: opened since midnight US Eastern, plus any still-open positions
 * (including entries from prior calendar days).
 */
export async function getTradesForTradingDay(
  dayStartIso = tradingDayStartUtc(),
): Promise<Trade[]> {
  const supabase = await createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    return [];
  }
  const query = supabase
    .from("trades")
    .select("*")
    .or(tradingDayTradesOrFilter(dayStartIso))
    .order("entry_time", { ascending: false });
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
