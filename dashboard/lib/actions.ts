"use server";

import { revalidatePath } from "next/cache";
import { buildSettingsAuditPayload } from "@/lib/allowlist";
import { resolveCurrentEquity } from "@/lib/resolve-current-equity";
import { createClient } from "@/lib/supabase/server";
import { parseSettingsForm } from "@/lib/validate-settings";

async function insertAuditLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: ReturnType<typeof buildSettingsAuditPayload>,
) {
  const { error } = await supabase.from("settings_audit_log").insert(payload);
  if (error) {
    console.warn("settings_audit_log insert failed:", error.message);
  }
}

export async function toggleBot(enabled: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: before } = await supabase
    .from("bot_status")
    .select("*")
    .eq("id", 1)
    .single();

  const { error } = await supabase
    .from("bot_status")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) throw new Error(error.message);

  const { data: after } = await supabase
    .from("bot_status")
    .select("*")
    .eq("id", 1)
    .single();

  await insertAuditLog(
    supabase,
    buildSettingsAuditPayload({
      action: "bot_toggle",
      actorUserId: user.id,
      actorEmail: user.email,
      before: (before as Record<string, unknown>) ?? {},
      after: (after as Record<string, unknown>) ?? { enabled },
    }),
  );

  revalidatePath("/");
  revalidatePath("/ops");
}

export async function updateSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: before } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();

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

  const { data: after } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();

  await insertAuditLog(
    supabase,
    buildSettingsAuditPayload({
      action: "settings_update",
      actorUserId: user.id,
      actorEmail: user.email,
      before: (before as Record<string, unknown>) ?? {},
      after: (after as Record<string, unknown>) ?? payload,
    }),
  );

  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/ops");
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
  revalidatePath("/ops");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
