"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { buildSettingsAiSummaryPacket } from "@/lib/settings-summary/packet";
import { generateSettingsAiSummaryFromPacket } from "@/lib/settings-summary/openai.server";
import type { SettingsAiSummary } from "@/lib/settings-summary/schema";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { canDashboardWrite } from "@/lib/dashboard-role";
import { readOnlyActionError } from "@/lib/require-dashboard-write.server";
import { resolveSettingsEquities } from "@/lib/risk-recommendations";
import { readLatestPortfolio, readSettings } from "@/lib/supabase/data-reads";
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
  if (!canDashboardWrite(user)) {
    return readOnlyActionError();
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
    readSettings(supabase),
    supabase.from("bot_status").select("*").eq("id", 1).single(),
    readLatestPortfolio(supabase),
  ]);

  const settings = settingsRes.data;
  if (settingsRes.error || !settings) {
    return { ok: false, error: settingsRes.error?.message ?? "Settings not found." };
  }

  const { currentEquity, baselineEquity } = resolveSettingsEquities(
    settings,
    portfolioRes.data?.equity,
  );

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
