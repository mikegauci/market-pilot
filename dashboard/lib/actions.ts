"use server";

import { revalidatePath } from "next/cache";
import { resolveCurrentEquity } from "@/lib/resolve-current-equity";
import { createClient } from "@/lib/supabase/server";
import { isTraderOnline } from "@/lib/trader-status";
import { parseSettingsForm, parseWatchlistSymbols } from "@/lib/validate-settings";

export async function updateSettings(formData: FormData) {
  const supabase = await createClient();
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
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/strategy");
}

export async function updateWatchlist(symbols: string[]) {
  const watchlist = parseWatchlistSymbols(symbols);
  const supabase = await createClient();

  const { error } = await supabase
    .from("settings")
    .update({ watchlist, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/strategy");
}

export async function setAutoTradingEnabled(enabled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bot_status")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/trades");
}

export async function requestTraderShutdown() {
  const supabase = await createClient();
  const { data: status, error: readError } = await supabase
    .from("bot_status")
    .select("last_heartbeat, shutdown_requested")
    .eq("id", 1)
    .single();
  if (readError || !status) {
    throw new Error(readError?.message ?? "Could not read bot status");
  }
  if (!isTraderOnline(status.last_heartbeat)) {
    throw new Error(
      "Trader is offline — stop the process in your terminal (Ctrl+C), or start it first to use Stop engine",
    );
  }
  if (status.shutdown_requested) {
    return;
  }
  const { error } = await supabase
    .from("bot_status")
    .update({
      shutdown_requested: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function cancelTraderShutdown() {
  const supabase = await createClient();
  const { data: status, error: readError } = await supabase
    .from("bot_status")
    .select("last_heartbeat, shutdown_requested")
    .eq("id", 1)
    .single();
  if (readError || !status) {
    throw new Error(readError?.message ?? "Could not read bot status");
  }
  if (!status.shutdown_requested) {
    return;
  }
  if (isTraderOnline(status.last_heartbeat)) {
    throw new Error("Engine is still stopping — wait for it to go offline");
  }
  const { error } = await supabase
    .from("bot_status")
    .update({
      shutdown_requested: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function requestClosePosition(tradeId: string) {
  const supabase = await createClient();

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

  const { data: existing } = await supabase
    .from("trade_commands")
    .select("id")
    .eq("trade_id", tradeId)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (existing) {
    throw new Error("Close already requested for this trade");
  }

  const { error } = await supabase.from("trade_commands").insert({
    trade_id: tradeId,
    command: "close",
    reason: "manual_dashboard",
  });

  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath("/trades");
}

export async function requestCoverShort(symbol: string, quantity: number) {
  const supabase = await createClient();
  const normalized = symbol.trim().toUpperCase();
  const qty = Math.trunc(quantity);

  if (!normalized) {
    throw new Error("Symbol is required");
  }
  if (!Number.isFinite(qty) || qty < 1) {
    throw new Error("Cover quantity must be at least 1 share");
  }

  const { data: existing } = await supabase
    .from("position_commands")
    .select("id")
    .eq("symbol", normalized)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (existing) {
    throw new Error("Cover already requested for this symbol");
  }

  const { error } = await supabase.from("position_commands").insert({
    symbol: normalized,
    quantity: qty,
    command: "cover_short",
    reason: "manual_dashboard",
  });

  if (error) throw new Error(error.message);

  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
