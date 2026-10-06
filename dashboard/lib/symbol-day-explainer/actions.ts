"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { buildSymbolDayExplainPacket } from "@/lib/symbol-day-explainer/packet";
import { generateSymbolDayExplanation } from "@/lib/symbol-day-explainer/openai.server";
import type { SymbolDayExplanation } from "@/lib/symbol-day-explainer/schema";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { createClient } from "@/lib/supabase/server";
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
    return { ok: false, error: "Sign in to explain symbol activity." };
  }

  const cooldownError = checkOpenAiActionCooldown(
    user.id,
    `symbol-day:${symbol}`,
    OPENAI_COOLDOWN_MS.symbolDayExplain,
  );
  if (cooldownError) {
    return { ok: false, error: cooldownError };
  }

  const { data: rows, error } = await supabase
    .from("predictions")
    .select("*")
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

  try {
    const result = await generateSymbolDayExplanation(packet);
    return { ok: true, explanation: result.explanation };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }
}
