"use server";

import { filterTradesByActiveIbkrAccount } from "@/lib/ibkr-trade-scope";
import { etDayBoundsUtc, etSessionCloseUtc } from "@/lib/market-hours";
import { buildSessionPacket, symbolsNeedingBars } from "@/lib/session-brief/packet";
import type { ReplayBar } from "@/lib/session-brief/replay";
import {
  isAiActionFailure,
  loadSettingsForAi,
  withAiAction,
} from "@/lib/openai/with-ai-action.server";
import { generateSessionBriefFromPacket } from "@/lib/session-brief/openai.server";
import { assertSessionDateAllowed } from "@/lib/session-brief/session-date";
import { parseSessionBriefStats } from "@/lib/session-brief/stats";
import { createClient } from "@/lib/supabase/server";
import { resolveTradeAccountScope } from "@/lib/trade-account-scope";
import type { SessionBriefRow, Trade } from "@/lib/types/database";

export type GenerateSessionBriefResult =
  | { ok: true; row: SessionBriefRow }
  | { ok: false; error: string };

const MIN_REGENERATE_MS = 15_000;

async function latestPredictionSessionDate(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("latest_prediction_session_date");
  if (error) {
    throw new Error(error.message);
  }
  return typeof data === "string" ? data : null;
}

async function resolveSessionDate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionDate?: string,
): Promise<string | null> {
  if (sessionDate?.trim()) {
    return sessionDate.trim();
  }
  return latestPredictionSessionDate(supabase);
}

async function fetchClosedTradesForSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionDate: string,
): Promise<{ trades: Trade[]; tradesIncomplete: boolean }> {
  const { startIso, endIso } = etDayBoundsUtc(sessionDate);
  const baseQuery = supabase
    .from("trades")
    .select("*")
    .eq("status", "closed")
    .gte("exit_time", startIso)
    .lt("exit_time", endIso)
    .order("exit_time", { ascending: false })
    .limit(500);

  const { accountId, includeLegacy } = await resolveTradeAccountScope(supabase);
  if (!accountId) {
    const { data, error } = await baseQuery;
    if (error) {
      throw new Error(error.message);
    }
    return { trades: (data ?? []) as Trade[], tradesIncomplete: true };
  }

  const scopedQuery = await filterTradesByActiveIbkrAccount(
    supabase,
    accountId,
    baseQuery,
    includeLegacy,
  );
  const { data, error } = await scopedQuery;
  if (error) {
    throw new Error(error.message);
  }
  return { trades: (data ?? []) as Trade[], tradesIncomplete: false };
}

const BARS_PAGE = 1000;

async function fetchSessionBars(
  supabase: Awaited<ReturnType<typeof createClient>>,
  symbols: string[],
  sessionDate: string,
): Promise<Map<string, ReplayBar[]>> {
  const bySymbol = new Map<string, ReplayBar[]>();
  if (symbols.length === 0) return bySymbol;
  const { startIso, endIso } = etDayBoundsUtc(sessionDate);
  for (let from = 0; ; from += BARS_PAGE) {
    const { data, error } = await supabase
      .from("symbol_bars")
      .select("symbol, ts, high, low, close")
      .eq("bar_size", "5 mins")
      .in("symbol", symbols)
      .gte("ts", startIso)
      .lt("ts", endIso)
      .order("ts", { ascending: true })
      .order("symbol", { ascending: true })
      .range(from, from + BARS_PAGE - 1);
    // Bars only add the "what happened next" replay; the brief still works without them.
    // Drop everything on a failed page so a half-loaded day never looks like a full one.
    if (error || !data) return new Map();
    for (const row of data as { symbol: string; ts: string; high: number; low: number; close: number }[]) {
      const list = bySymbol.get(row.symbol) ?? [];
      list.push({ ts: row.ts, high: Number(row.high), low: Number(row.low), close: Number(row.close) });
      bySymbol.set(row.symbol, list);
    }
    if (data.length < BARS_PAGE) break;
  }
  return bySymbol;
}

export async function generateSessionBrief(
  sessionDate?: string,
): Promise<GenerateSessionBriefResult> {
  return withAiAction<GenerateSessionBriefResult>(
    { signInMessage: "Sign in to generate a session brief." },
    async ({ supabase, user }) => {
      const latestDay = await latestPredictionSessionDate(supabase);
      const day = await resolveSessionDate(supabase, sessionDate);
      if (!day) {
        return { ok: false, error: "No prediction data yet — run the trader first." };
      }

      const dateError = assertSessionDateAllowed(day, latestDay);
      if (dateError) {
        return { ok: false, error: dateError };
      }

      // Per-session DB check instead of the in-memory cooldown, so it holds across instances.
      const { data: recentBrief } = await supabase
        .from("session_briefs")
        .select("created_at")
        .eq("created_by", user.id)
        .eq("session_date", day)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentBrief?.created_at) {
        const elapsed = Date.now() - new Date(recentBrief.created_at).getTime();
        if (elapsed < MIN_REGENERATE_MS) {
          return {
            ok: false,
            error: "Please wait a few seconds before generating another brief.",
          };
        }
      }

      const { data: statsRaw, error: statsError } = await supabase.rpc(
        "get_session_brief_stats",
        { p_day: day },
      );
      if (statsError) {
        return { ok: false, error: statsError.message };
      }

      const stats = parseSessionBriefStats(statsRaw);
      if (stats.total <= 0) {
        return {
          ok: false,
          error: `No predictions for session ${day}. Pick another day or wait for the bot to run.`,
        };
      }

      const settings = await loadSettingsForAi(supabase);
      if (isAiActionFailure(settings)) return settings;

      const { trades, tradesIncomplete } = await fetchClosedTradesForSession(supabase, day);

      const barsBySymbol = await fetchSessionBars(
        supabase,
        symbolsNeedingBars(stats, trades),
        day,
      );

      const packet = buildSessionPacket({
        sessionDate: day,
        stats,
        trades,
        settings,
        barsBySymbol,
        sessionClose: etSessionCloseUtc(day),
      });

      if (tradesIncomplete) {
        packet.trades_scope_warning =
          trades.length === 0 && stats.traded > 0
            ? "Closed trades could not be matched to the active broker account, so the trade section may be empty."
            : "The trade list may not match the active broker account. Check it against the Trades page.";
      }

      const briefResult = await generateSessionBriefFromPacket(packet);

      const { data: inserted, error: insertError } = await supabase
        .from("session_briefs")
        .insert({
          session_date: day,
          model: briefResult.model,
          input: packet,
          brief: briefResult.brief,
          created_by: user.id,
        })
        .select("*")
        .single();

      if (insertError || !inserted) {
        return { ok: false, error: insertError?.message ?? "Could not save session brief." };
      }

      return { ok: true, row: inserted as SessionBriefRow };
    },
  );
}
