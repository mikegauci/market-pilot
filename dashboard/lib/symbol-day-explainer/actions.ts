"use server";

import { OPENAI_COOLDOWN_MS } from "@/lib/openai-action-cooldown";
import { withAiAction } from "@/lib/openai/with-ai-action.server";
import { buildSymbolDayExplainPacket } from "@/lib/symbol-day-explainer/packet";
import { generateSymbolDayExplanation } from "@/lib/symbol-day-explainer/openai.server";
import type { SymbolDayExplanation } from "@/lib/symbol-day-explainer/schema";
import { ANALYTICS_SKIP_PREDICTION_COLUMNS } from "@/lib/analytics-data";
import type { Prediction } from "@/lib/types/database";

export type ExplainSymbolDayResult =
  | { ok: true; explanation: SymbolDayExplanation }
  | { ok: false; error: string };

export async function explainSymbolTradingDay(input: {
  symbol: string;
  sessionStartIso: string;
  recordThreshold: number;
  minConfidence: number;
}): Promise<ExplainSymbolDayResult> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, error: "Pick a symbol." };
  }

  return withAiAction<ExplainSymbolDayResult>(
    {
      signInMessage: "Sign in to explain symbol activity.",
      cooldown: { key: `symbol-day:${symbol}`, ms: OPENAI_COOLDOWN_MS.symbolDayExplain },
    },
    async ({ supabase }) => {
      const { data: rows, error } = await supabase
        .from("predictions")
        .select(ANALYTICS_SKIP_PREDICTION_COLUMNS)
        .eq("symbol", symbol)
        .gte("timestamp", input.sessionStartIso)
        .order("timestamp", { ascending: false })
        .limit(400);

      if (error) {
        return { ok: false, error: error.message };
      }

      const predictions = (rows ?? []) as Prediction[];
      if (predictions.length === 0) {
        return { ok: false, error: "No predictions for this symbol in the session window." };
      }

      const packet = buildSymbolDayExplainPacket(
        symbol,
        predictions,
        input.sessionStartIso,
        input.recordThreshold,
        input.minConfidence,
      );

      const result = await generateSymbolDayExplanation(packet);
      return { ok: true, explanation: result.explanation };
    },
  );
}
