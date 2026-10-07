"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { buildMorningBriefPacket, MORNING_BRIEF_WINDOW_HOURS } from "@/lib/morning-brief/packet";
import { generateMorningBriefFromPacket } from "@/lib/morning-brief/openai.server";
import { constrainMorningBrief, type MorningBrief } from "@/lib/morning-brief/schema";
import { normalizeSettings, type SettingsRow } from "@/lib/normalize-settings";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { canDashboardWrite } from "@/lib/dashboard-role";
import { readOnlyActionError } from "@/lib/require-dashboard-write.server";
import { createClient } from "@/lib/supabase/server";
import type { MarketNewsRow } from "@/lib/types/database";

export type GenerateMorningBriefResult =
  | { ok: true; brief: MorningBrief; generatedAt: string }
  | { ok: false; error: string };

export async function generateMorningBrief(): Promise<GenerateMorningBriefResult> {
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
    return { ok: false, error: "Sign in to generate a morning brief." };
  }
  if (!canDashboardWrite(user)) {
    return readOnlyActionError();
  }

  const cooldownError = checkOpenAiActionCooldown(
    user.id,
    "morning-brief",
    OPENAI_COOLDOWN_MS.morningBrief,
  );
  if (cooldownError) {
    return { ok: false, error: cooldownError };
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (settingsError || !settingsRow) {
    return { ok: false, error: settingsError?.message ?? "Settings not found." };
  }

  const settings = normalizeSettings(settingsRow as SettingsRow);
  if (!settings) {
    return { ok: false, error: "Settings not found." };
  }

  const since = new Date(Date.now() - MORNING_BRIEF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data: newsRows, error: newsError } = await supabase
    .from("market_news")
    .select("headline, related_symbols, published_at, sentiment, tags")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(100);

  if (newsError) {
    return { ok: false, error: newsError.message };
  }

  const now = new Date();
  let packet;
  try {
    packet = buildMorningBriefPacket({
      settings,
      articles: (newsRows ?? []) as MarketNewsRow[],
      now,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build morning brief.",
    };
  }

  try {
    const result = await generateMorningBriefFromPacket(packet);
    const allowed = new Set(packet.watchlist.map((row) => row.symbol));
    return {
      ok: true,
      brief: constrainMorningBrief(result.brief, allowed),
      generatedAt: now.toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }
}
