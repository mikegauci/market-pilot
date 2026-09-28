"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  const watchlistRaw = String(formData.get("watchlist") ?? "");
  const watchlist = watchlistRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const payload = {
    minimum_jev_confidence: Number(formData.get("minimum_jev_confidence")),
    signal_record_threshold: Number(formData.get("signal_record_threshold")),
    risk_per_trade: Number(formData.get("risk_per_trade")),
    max_position_size: Number(formData.get("max_position_size")),
    max_daily_loss: Number(formData.get("max_daily_loss")),
    max_open_positions: Number(formData.get("max_open_positions")),
    stop_loss_percentage: Number(formData.get("stop_loss_percentage")),
    take_profit_percentage: Number(formData.get("take_profit_percentage")),
    watchlist,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("settings").update(payload).eq("id", 1);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
