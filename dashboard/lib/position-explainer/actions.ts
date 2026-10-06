"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { normalizeSettings, type SettingsRow } from "@/lib/normalize-settings";
import { buildPositionExplainPacket } from "@/lib/position-explainer/packet";
import { generatePositionExplanation } from "@/lib/position-explainer/openai.server";
import type { PositionExplanation } from "@/lib/position-explainer/schema";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import { createClient } from "@/lib/supabase/server";
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
    return { ok: false, error: "Sign in to explain a position." };
  }

  const cooldownError = checkOpenAiActionCooldown(
    user.id,
    `position-explain:${symbol}`,
    OPENAI_COOLDOWN_MS.positionExplain,
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

  try {
    const result = await generatePositionExplanation(packet);
    return { ok: true, explanation: result.explanation };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }
}
