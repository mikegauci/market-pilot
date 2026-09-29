"use server";

import { revalidatePath } from "next/cache";
import { resolveCurrentEquity } from "@/lib/resolve-current-equity";
import { createClient } from "@/lib/supabase/server";
import { parseSettingsForm } from "@/lib/validate-settings";

export async function toggleBot(enabled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bot_status")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function updateSettings(formData: FormData) {
  const supabase = await createClient();
  const parsed = parseSettingsForm(formData);
  const equityForBaseline = await resolveCurrentEquity();

  const payload: Record<string, unknown> = {
    ...parsed,
    updated_at: new Date().toISOString(),
  };

  if (parsed.watchlist_dynamic_enabled) {
    delete payload.watchlist;
  }

  if (equityForBaseline > 0) {
    payload.risk_sync_equity = equityForBaseline;
  }

  const { error } = await supabase.from("settings").update(payload).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
