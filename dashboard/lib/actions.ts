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

export async function setExecutionMode(mode: "simulated" | "ibkr") {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bot_status")
    .update({ execution_mode: mode, updated_at: new Date().toISOString() })
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

  if (equityForBaseline > 0) {
    payload.risk_sync_equity = equityForBaseline;
  }

  const { error } = await supabase.from("settings").update(payload).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
