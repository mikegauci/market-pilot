"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { normalizeSettings, type SettingsRow } from "@/lib/normalize-settings";
import { buildSettingsAiSummaryPacket } from "@/lib/settings-summary/packet";
import { generateSettingsAiSummaryFromPacket } from "@/lib/settings-summary/openai.server";
import type { SettingsAiSummary } from "@/lib/settings-summary/schema";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { createClient } from "@/lib/supabase/server";
import type { BotStatus } from "@/lib/types/database";

export type GenerateSettingsAiSummaryResult =
  | { ok: true; summary: SettingsAiSummary; generatedAt: string }
  | { ok: false; error: string };

export async function generateSettingsAiSummary(): Promise<GenerateSettingsAiSummaryResult> {
  try {
    requireOpenAiKey();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI is not configured.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to generate a settings summary." };
  }

  const cooldownError = checkOpenAiActionCooldown(
    user.id,
    "settings-ai-summary",
    OPENAI_COOLDOWN_MS.settingsAiSummary,
  );
  if (cooldownError) {
    return { ok: false, error: cooldownError };
  }

  const [settingsRes, botRes, portfolioRes] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).single(),
    supabase.from("bot_status").select("*").eq("id", 1).single(),
    supabase
      .from("portfolio_history")
      .select("equity")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (settingsRes.error || !settingsRes.data) {
    return { ok: false, error: settingsRes.error?.message ?? "Settings not found." };
  }

  const settings = normalizeSettings(settingsRes.data as SettingsRow);
  if (!settings) {
    return { ok: false, error: "Settings not found." };
  }

  const currentEquity = portfolioRes.data?.equity ?? settings.account_capital;
  const baselineEquity =
    settings.risk_sync_equity != null && settings.risk_sync_equity > 0
      ? settings.risk_sync_equity
      : currentEquity > 0
        ? currentEquity
        : settings.account_capital;

  const now = new Date();
  let packet;
  try {
    packet = buildSettingsAiSummaryPacket({
      settings,
      baselineEquity,
      currentEquity,
      botStatus: (botRes.data as BotStatus | null) ?? null,
      now,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build settings summary.",
    };
  }

  try {
    const result = await generateSettingsAiSummaryFromPacket(packet);
    return {
      ok: true,
      summary: result.summary,
      generatedAt: now.toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }
}
