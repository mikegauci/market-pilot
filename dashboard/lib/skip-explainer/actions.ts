"use server";

import { OPENAI_COOLDOWN_MS } from "@/lib/openai-action-cooldown";
import {
  isAiActionFailure,
  loadSettingsForAi,
  withAiAction,
} from "@/lib/openai/with-ai-action.server";
import {
  buildDeterministicPreJevSkipExplanation,
  buildSkipExplainPacket,
} from "@/lib/skip-explainer/packet";
import { generateSkipExplanation } from "@/lib/skip-explainer/openai.server";
import type { SkipExplanation } from "@/lib/skip-explainer/schema";
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

  return withAiAction<ExplainSkipResult>(
    {
      signInMessage: "Sign in to explain a skipped prediction.",
      cooldown: { key: `skip-explain:${id}`, ms: OPENAI_COOLDOWN_MS.skipExplain },
    },
    async ({ supabase }) => {
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

      const settings = await loadSettingsForAi(supabase);
      if (isAiActionFailure(settings)) return settings;

      const packet = buildSkipExplainPacket(prediction, settings);
      if (!packet.jev_was_called) {
        return { ok: true, explanation: buildDeterministicPreJevSkipExplanation(packet) };
      }

      const result = await generateSkipExplanation(packet);
      return { ok: true, explanation: result.explanation };
    },
  );
}
