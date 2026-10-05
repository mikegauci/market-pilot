"use server";

import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { buildSkipExplainPacket } from "@/lib/skip-explainer/packet";
import { generateSkipExplanation } from "@/lib/skip-explainer/openai.server";
import type { SkipExplanation } from "@/lib/skip-explainer/schema";
import { createClient } from "@/lib/supabase/server";
import type { Prediction, Settings } from "@/lib/types/database";

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

  const packet = buildSkipExplainPacket(prediction, settingsRow as Settings);

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
