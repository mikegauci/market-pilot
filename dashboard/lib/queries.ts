import "server-only";

import {
  ANALYTICS_SKIP_LOOKBACK_HOURS,
  ANALYTICS_SKIP_REASON_LIMIT,
} from "@/lib/analytics-data";
import { tradingDayStartUtc } from "@/lib/market-hours";
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
import { resolveTradeAccountScope, type TradeAccountScope } from "@/lib/trade-account-scope";
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
  readPredictionFeedPage,
  readPredictionFeedPageForId,
  readPredictionFeedSymbols,
  readSettings,
  readSymbolBars,
  readTradedPredictions,
  readTradesForTradingDay,
} from "@/lib/supabase/data-reads";
import { canDashboardWrite } from "@/lib/dashboard-role";
import { createClient } from "@/lib/supabase/server";
import type {
  BotStatus,
  MarketNewsRow,
  IbkrAccountProfile,
  PortfolioSnapshot,
  Position,
  PositionCommand,
  Prediction,
  SessionBriefRow,
  Settings,
  SymbolBar,
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (canDashboardWrite(user)) {
    const { expireEntryBlocksIfDue } = await import("@/lib/entry-block-expire.server");
    await expireEntryBlocksIfDue(supabase);
  }
  const { data } = await readSettings(supabase);
  return data;
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
  const { data } = await readLatestPortfolio(supabase);
  return data;
}

export async function getPortfolioHistory(limit = 5000): Promise<PortfolioSnapshot[]> {
  const supabase = await createClient();
  const { data } = await readPortfolioHistory(supabase, limit);
  return data;
}

export async function getClosedTrades(): Promise<Trade[]> {
  const supabase = await createClient();
  const { data } = await readClosedTrades(supabase);
  return data;
}

export async function getAnalyticsPredictions(
  limit = ANALYTICS_SKIP_REASON_LIMIT,
  lookbackHours = ANALYTICS_SKIP_LOOKBACK_HOURS,
): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data } = await readAnalyticsPredictions(supabase, limit, lookbackHours);
  return data;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const mixParams = {
    p_since: SESSION_BRIEF_FIRST_DATE,
    p_headwind_floor: STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct,
  };
  let refreshError: { message: string } | null = null;
  if (canDashboardWrite(user)) {
    const { error } = await supabase.rpc("refresh_session_market_condition_mix", mixParams);
    refreshError = error;
  }
  const { data, error } = await supabase.rpc("list_session_market_condition_mix", mixParams);
  if (error) {
    return { rows: [], loadError: error.message };
  }
  const rows = parseSessionConditionMix(data);
  if (rows.length === 0 && refreshError) {
    return { rows: [], loadError: refreshError.message };
  }
  return { rows, loadError: null };
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

export async function getLatestPredictionsBySymbol(
  limit?: number,
): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data, error } = await readLatestPredictionsBySymbol(supabase, limit);
  if (error) {
    return [];
  }
  return data;
}

export async function getPositions(): Promise<Position[]> {
  const supabase = await createClient();
  const { data } = await readPositions(supabase);
  return data;
}

export async function getOpenTrades(): Promise<Trade[]> {
  const supabase = await createClient();
  const { data } = await readOpenTrades(supabase);
  return data;
}

export async function getActiveTradeCommands(): Promise<TradeCommand[]> {
  const supabase = await createClient();
  const { data } = await readActiveTradeCommands(supabase);
  return data;
}

export async function getActivePositionCommands(): Promise<PositionCommand[]> {
  const supabase = await createClient();
  const { data } = await readActivePositionCommands(supabase);
  return data;
}

/**
 * Overview trades: opened since midnight US Eastern, plus any still-open positions
 * (including entries from prior calendar days).
 */
export async function getTradesForTradingDay(
  dayStartIso = tradingDayStartUtc(),
): Promise<Trade[]> {
  const supabase = await createClient();
  const { data } = await readTradesForTradingDay(supabase, dayStartIso);
  return data;
}

export async function getAllTrades(status?: "open" | "closed" | "all"): Promise<Trade[]> {
  const supabase = await createClient();
  const { data } = await readAllTrades(supabase, status);
  return data;
}

export async function getTradeAccountScope(): Promise<TradeAccountScope> {
  const supabase = await createClient();
  return resolveTradeAccountScope(supabase);
}

export type TradesPageLoad = {
  trades: Trade[];
  tradeScope: TradeAccountScope;
};

/** Single scope resolution before trade read (avoids duplicate infer queries on first paint). */
export async function getTradesPageLoad(
  status: "open" | "closed" | "all" = "all",
): Promise<TradesPageLoad> {
  const supabase = await createClient();
  const tradeScope = await resolveTradeAccountScope(supabase);
  const { data: trades } = await readAllTrades(supabase, status);
  return { trades, tradeScope };
}

export type PredictionsPageLoad = {
  predictions: Prediction[];
  loadError: string | null;
  totalCount: number;
  page: number;
  pageSize: number;
  sessionStartIso: string;
  symbols: string[];
};

export async function getPredictionsPage(
  page: number,
  pageSize: number,
  options?: {
    symbol?: string;
    sessionStartIso?: string;
    /** When set, jump to the page that contains this prediction (deep link). */
    expandToPredictionId?: string | null;
  },
): Promise<PredictionsPageLoad> {
  const supabase = await createClient();
  const sessionStartIso = options?.sessionStartIso ?? tradingDayStartUtc();
  const symbol = options?.symbol?.trim() || undefined;

  let resolvedPage = Math.max(1, page);
  if (options?.expandToPredictionId) {
    const { data: pageForId } = await readPredictionFeedPageForId(
      supabase,
      options.expandToPredictionId,
      pageSize,
      sessionStartIso,
      symbol,
    );
    resolvedPage = pageForId;
  }

  const [{ data, error }, { data: symbols, error: symbolsError }] = await Promise.all([
    readPredictionFeedPage(supabase, {
      limit: pageSize,
      offset: (resolvedPage - 1) * pageSize,
      symbol,
      sinceIso: sessionStartIso,
    }),
    readPredictionFeedSymbols(supabase, sessionStartIso),
  ]);

  if (error) {
    console.warn("predictions feed load failed:", error.message);
  }
  if (symbolsError) {
    console.warn("prediction symbols load failed:", symbolsError.message);
  }

  const totalCount = data.totalCount;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
  const clampedPage = Math.min(resolvedPage, pageCount);

  if (clampedPage !== resolvedPage) {
    const retry = await readPredictionFeedPage(supabase, {
      limit: pageSize,
      offset: (clampedPage - 1) * pageSize,
      symbol,
      sinceIso: sessionStartIso,
    });
    return {
      predictions: retry.data.predictions,
      loadError: retry.error?.message ?? error?.message ?? null,
      totalCount: retry.data.totalCount,
      page: clampedPage,
      pageSize,
      sessionStartIso,
      symbols,
    };
  }

  return {
    predictions: data.predictions,
    loadError: error?.message ?? null,
    totalCount,
    page: clampedPage,
    pageSize,
    sessionStartIso,
    symbols,
  };
}

export async function getMarketNews(limit = 100): Promise<MarketNewsRow[]> {
  const supabase = await createClient();
  const { data } = await readMarketNews(supabase, limit);
  return data;
}

export async function getTradedPredictions(limit = 10): Promise<Prediction[]> {
  const supabase = await createClient();
  const { data } = await readTradedPredictions(supabase, limit);
  return data;
}

export async function getSymbolBars(
  symbol: string,
  barSize = "5 mins",
  limit = 500,
): Promise<SymbolBar[]> {
  const supabase = await createClient();
  const { data } = await readSymbolBars(supabase, symbol, barSize, limit);
  return data;
}
