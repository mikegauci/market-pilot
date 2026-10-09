"use server";

import { OPENAI_COOLDOWN_MS } from "@/lib/openai-action-cooldown";
import { withAiAction } from "@/lib/openai/with-ai-action.server";
import { buildSettingsAiSummaryPacket } from "@/lib/settings-summary/packet";
import { generateSettingsAiSummaryFromPacket } from "@/lib/settings-summary/openai.server";
import type { SettingsAiSummary } from "@/lib/settings-summary/schema";
import { resolveSettingsEquities } from "@/lib/risk-recommendations";
import { readLatestPortfolio, readSettings } from "@/lib/supabase/data-reads";
import type { BotStatus } from "@/lib/types/database";

export type GenerateSettingsAiSummaryResult =
  | { ok: true; summary: SettingsAiSummary; generatedAt: string }
  | { ok: false; error: string };

export async function generateSettingsAiSummary(): Promise<GenerateSettingsAiSummaryResult> {
  return withAiAction<GenerateSettingsAiSummaryResult>(
    {
      signInMessage: "Sign in to generate a settings summary.",
      cooldown: { key: "settings-ai-summary", ms: OPENAI_COOLDOWN_MS.settingsAiSummary },
    },
    async ({ supabase }) => {
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
      const packet = buildSettingsAiSummaryPacket({
        settings,
        baselineEquity,
        currentEquity,
        botStatus: (botRes.data as BotStatus | null) ?? null,
        now,
      });

      const result = await generateSettingsAiSummaryFromPacket(packet);
      return {
        ok: true,
        summary: result.summary,
        generatedAt: now.toISOString(),
      };
    },
  );
}
