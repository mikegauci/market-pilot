"use server";

import { revalidatePath } from "next/cache";
import { resolveCurrentEquity } from "@/lib/resolve-current-equity";
import { createClient } from "@/lib/supabase/server";
import { isTraderOnline } from "@/lib/trader-status";
import {
  clearEntryBlockedAt,
  mergeEntryBlockedSymbols,
  removeEntryBlockedSymbol,
  stampEntryBlockedAt,
} from "@/lib/entry-blocked-symbols";
import { seedActiveWatchlistFromPool } from "@/lib/seed-active-watchlist";
import { requireDashboardWriteClient } from "@/lib/require-dashboard-write.server";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { normalizeSettings } from "@/lib/normalize-settings";
import { parseSettingsForm, parseWatchlistSymbols } from "@/lib/validate-settings";

type DashboardSupabase = Awaited<ReturnType<typeof requireDashboardWriteClient>>;

function revalidateEntryBlockPaths() {
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/strategy");
}

function revalidateTradePaths() {
  revalidatePath("/");
  revalidatePath("/trades");
}

/** Insert a manual command row unless one for the same target is still pending or processing. */
async function enqueueCommand(
  supabase: DashboardSupabase,
  table: "entry_commands" | "trade_commands" | "position_commands",
  match: { column: "symbol" | "trade_id"; value: string },
  row: Record<string, unknown>,
  duplicateMessage: string,
) {
  const { data: existing } = await supabase
    .from(table)
    .select("id")
    .eq(match.column, match.value)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (existing) {
    throw new Error(duplicateMessage);
  }

  const { error } = await supabase.from(table).insert({ ...row, reason: "manual_dashboard" });
  if (error) throw new Error(error.message);
}

function withoutSymbol(list: string[] | null, symbol: string): string[] {
  return (list ?? []).map((item) => item.toUpperCase()).filter((item) => item && item !== symbol);
}

async function setShutdownRequested(requested: boolean) {
  const supabase = await requireDashboardWriteClient();
  const { data: status, error: readError } = await supabase
    .from("bot_status")
    .select("last_heartbeat, shutdown_requested")
    .eq("id", 1)
    .single();
  if (readError || !status) {
    throw new Error(readError?.message ?? "Could not read bot status");
  }
  const online = isTraderOnline(status.last_heartbeat);
  if (requested) {
    if (!online) {
      throw new Error(
        "Trader is offline — stop the process in your terminal (Ctrl+C), or start it first to use Stop engine",
      );
    }
    if (status.shutdown_requested) return;
  } else {
    if (!status.shutdown_requested) return;
    if (online) {
      throw new Error("Engine is still stopping — wait for it to go offline");
    }
  }
  const { error } = await supabase
    .from("bot_status")
    .update({
      shutdown_requested: requested,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function updateSettings(formData: FormData) {
  const supabase = await requireDashboardWriteClient();
  const parsed = parseSettingsForm(formData);
  const equityForBaseline = await resolveCurrentEquity();

  const payload: Record<string, unknown> = {
    ...parsed,
    updated_at: new Date().toISOString(),
  };

  if (equityForBaseline > 0) {
    payload.risk_sync_equity = equityForBaseline;
  }

  const { error } = await supabase.from("settings").update(payload).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidateEntryBlockPaths();
}

export async function blockSymbolFromEntries(symbol: string) {
  const [normalized] = parseWatchlistSymbols([symbol]);
  const supabase = await requireDashboardWriteClient();

  const { data: settings, error: readError } = await supabase
    .from("settings")
    .select(
      "entry_blocked_symbols, entry_blocked_at, watchlist_active, watchlist_rotation_enabled, watchlist, watchlist_pool, watchlist_active_size",
    )
    .eq("id", 1)
    .single();

  if (readError || !settings) {
    throw new Error(readError?.message ?? "Could not read settings");
  }

  const entry_blocked_symbols = mergeEntryBlockedSymbols(
    settings.entry_blocked_symbols as string[] | null,
    [normalized],
  );

  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = {
    entry_blocked_symbols,
    entry_blocked_at: stampEntryBlockedAt(
      settings.entry_blocked_at as Record<string, string> | null,
      [normalized],
      nowIso,
    ),
    updated_at: nowIso,
  };

  if (settings.watchlist_rotation_enabled) {
    let nextActive = withoutSymbol(settings.watchlist_active as string[] | null, normalized);
    if (nextActive.length === 0) {
      nextActive = seedActiveWatchlistFromPool(
        (settings.watchlist_pool as string[] | null) ?? [],
        entry_blocked_symbols,
        Number(settings.watchlist_active_size ?? 12),
      );
    }
    payload.watchlist_active = nextActive;
  } else {
    const nextWatchlist = withoutSymbol(settings.watchlist as string[] | null, normalized);
    if (nextWatchlist.length < 1) {
      throw new Error("Keep at least one symbol on the watchlist.");
    }
    payload.watchlist = nextWatchlist;
  }

  const { error } = await supabase.from("settings").update(payload).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidateEntryBlockPaths();
}

export async function unblockSymbolFromEntries(symbol: string) {
  const [normalized] = parseWatchlistSymbols([symbol]);
  const supabase = await requireDashboardWriteClient();

  const { data: settings, error: readError } = await supabase
    .from("settings")
    .select("entry_blocked_symbols, entry_blocked_at")
    .eq("id", 1)
    .single();

  if (readError || !settings) {
    throw new Error(readError?.message ?? "Could not read settings");
  }

  const entry_blocked_symbols = removeEntryBlockedSymbol(
    settings.entry_blocked_symbols as string[] | null,
    normalized,
  );

  const { error } = await supabase
    .from("settings")
    .update({
      entry_blocked_symbols,
      entry_blocked_at: clearEntryBlockedAt(
        settings.entry_blocked_at as Record<string, string> | null,
        normalized,
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) throw new Error(error.message);
  revalidateEntryBlockPaths();
}

export async function updateWatchlist(symbols: string[]) {
  const watchlist = parseWatchlistSymbols(symbols);
  const supabase = await requireDashboardWriteClient();

  const { error } = await supabase
    .from("settings")
    .update({ watchlist, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidateEntryBlockPaths();
}

export async function setAutoTradingEnabled(enabled: boolean) {
  const supabase = await requireDashboardWriteClient();
  const { error } = await supabase
    .from("bot_status")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidateTradePaths();
}

export async function requestTraderShutdown() {
  await setShutdownRequested(true);
}

export async function cancelTraderShutdown() {
  await setShutdownRequested(false);
}

export async function requestManualBuy(symbol: string) {
  const supabase = await requireDashboardWriteClient();
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Symbol is required");
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (settingsError || !settingsRow) {
    throw new Error(settingsError?.message ?? "Could not read settings");
  }
  const settings = normalizeSettings(settingsRow);
  if (!settings) {
    throw new Error("Could not read settings");
  }
  const allowed = new Set(resolveEffectiveWatchlist(settings));
  if (!allowed.has(normalized)) {
    throw new Error(`${normalized} is not on your active watchlist`);
  }

  await enqueueCommand(
    supabase,
    "entry_commands",
    { column: "symbol", value: normalized },
    { symbol: normalized, command: "buy" },
    "Buy already requested for this symbol",
  );
  revalidateTradePaths();
}

export async function requestClosePosition(tradeId: string) {
  const supabase = await requireDashboardWriteClient();

  const { data: trade, error: tradeError } = await supabase
    .from("trades")
    .select("id, status")
    .eq("id", tradeId)
    .single();

  if (tradeError || !trade) {
    throw new Error(tradeError?.message ?? "Trade not found");
  }
  if (trade.status !== "open") {
    throw new Error("Trade is not open");
  }

  await enqueueCommand(
    supabase,
    "trade_commands",
    { column: "trade_id", value: tradeId },
    { trade_id: tradeId, command: "close" },
    "Close already requested for this trade",
  );
  revalidateTradePaths();
}

export async function requestCoverShort(symbol: string, quantity: number) {
  const supabase = await requireDashboardWriteClient();
  const normalized = symbol.trim().toUpperCase();
  const qty = Math.trunc(quantity);

  if (!normalized) {
    throw new Error("Symbol is required");
  }
  if (!Number.isFinite(qty) || qty < 1) {
    throw new Error("Cover quantity must be at least 1 share");
  }

  await enqueueCommand(
    supabase,
    "position_commands",
    { column: "symbol", value: normalized },
    { symbol: normalized, quantity: qty, command: "cover_short" },
    "Cover already requested for this symbol",
  );
  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
