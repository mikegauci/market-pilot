"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { normalizeSettings, type SettingsRow } from "@/lib/normalize-settings";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { buildSkipExplainPacket } from "@/lib/skip-explainer/packet";
import { generateSkipExplanation } from "@/lib/skip-explainer/openai.server";
import type { SkipExplanation } from "@/lib/skip-explainer/schema";
import { canDashboardWrite } from "@/lib/dashboard-role";
import { readOnlyActionError } from "@/lib/require-dashboard-write.server";
import { createClient } from "@/lib/supabase/server";
import type { Prediction } from "@/lib/types/database";

export type ExplainSkipResult =
  | { ok: true; explanation: SkipExplanation }
  | { ok: false; error: string };

export async function explainSkippedPrediction(
  predictionId: string,
): Promise<ExplainSkipResult> {
  const id = predictionId.trim();
  if (!id) {
    return { ok: false, error: "Missing prediction." };
  }

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
    return { ok: false, error: "Sign in to explain a skipped prediction." };
  }
  if (!canDashboardWrite(user)) {
    return readOnlyActionError();
  }

  const cooldownError = checkOpenAiActionCooldown(
    user.id,
    `skip-explain:${id}`,
    OPENAI_COOLDOWN_MS.skipExplain,
  );
  if (cooldownError) {
    return { ok: false, error: cooldownError };
  }

  const { data: predictionRow, error: predictionError } = await supabase
    .from("predictions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (predictionError) {
    return { ok: false, error: predictionError.message };
  }
  if (!predictionRow) {
    return { ok: false, error: "Prediction not found." };
  }

  const prediction = predictionRow as Prediction;
  if (prediction.trade_created) {
    return { ok: false, error: "The bot opened a trade on this prediction." };
  }
  if (!prediction.trade_skip_reason?.trim()) {
    return { ok: false, error: "This prediction has no skip reason to explain." };
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

  let packet;
  try {
    packet = buildSkipExplainPacket(prediction, settings);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not build explanation.",
    };
  }

  try {
    const result = await generateSkipExplanation(packet);
    return { ok: true, explanation: result.explanation };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }
}
