"use server";

import { OPENAI_COOLDOWN_MS } from "@/lib/openai-action-cooldown";
import {
  isAiActionFailure,
  loadSettingsForAi,
  withAiAction,
} from "@/lib/openai/with-ai-action.server";
import { buildPositionExplainPacket } from "@/lib/position-explainer/packet";
import { generatePositionExplanation } from "@/lib/position-explainer/openai.server";
import type { PositionExplanation } from "@/lib/position-explainer/schema";
import type { Prediction, Trade } from "@/lib/types/database";

export type ExplainPositionResult =
  | { ok: true; explanation: PositionExplanation }
  | { ok: false; error: string };

export async function explainOpenPosition(input: {
  symbol: string;
  quantity: number;
  avgCost: number;
  marketPrice: number | null;
  unrealizedPnl: number | null;
  tradeId: string | null;
}): Promise<ExplainPositionResult> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, error: "Missing symbol." };
  }

  return withAiAction<ExplainPositionResult>(
    {
      signInMessage: "Sign in to explain a position.",
      cooldown: { key: `position-explain:${symbol}`, ms: OPENAI_COOLDOWN_MS.positionExplain },
    },
    async ({ supabase }) => {
      const settings = await loadSettingsForAi(supabase);
      if (isAiActionFailure(settings)) return settings;

      let trade: Trade | null = null;
      if (input.tradeId?.trim()) {
        const { data: tradeRow } = await supabase
          .from("trades")
          .select("*")
          .eq("id", input.tradeId.trim())
          .maybeSingle();
        if (tradeRow) {
          trade = tradeRow as Trade;
        }
      }

      const { data: predictionRow } = await supabase
        .from("predictions")
        .select("*")
        .eq("symbol", symbol)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      const latestPrediction = (predictionRow as Prediction | null) ?? null;

      const packet = buildPositionExplainPacket(
        symbol,
        input.quantity,
        input.avgCost,
        input.marketPrice,
        input.unrealizedPnl,
        trade,
        latestPrediction,
        settings,
      );

      const result = await generatePositionExplanation(packet);
      return { ok: true, explanation: result.explanation };
    },
  );
}
