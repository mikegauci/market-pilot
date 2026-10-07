"use server";

import {
  checkOpenAiActionCooldown,
  OPENAI_COOLDOWN_MS,
} from "@/lib/openai-action-cooldown";
import { normalizeSettings, type SettingsRow } from "@/lib/normalize-settings";
import { requireOpenAiKey } from "@/lib/session-brief/openai.server";
import {
  closedTradeIsLoss,
  computeInTradePeak,
  computeLossCutPathStats,
  computeProfitTakePathStats,
  type PriceTick,
} from "@/lib/trade-recap/in-trade-peak";
import { buildTradeRecapPacket } from "@/lib/trade-recap/packet";
import { generateTradeRecap } from "@/lib/trade-recap/openai.server";
import type { TradeRecap } from "@/lib/trade-recap/schema";
import { createClient } from "@/lib/supabase/server";
import type { Trade } from "@/lib/types/database";

export type TradeRecapResult =
  | { ok: true; recap: TradeRecap }
  | { ok: false; error: string };

export async function explainTradeRecap(tradeId: string): Promise<TradeRecapResult> {
  const id = tradeId.trim();
  if (!id) {
    return { ok: false, error: "Missing trade." };
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
    return { ok: false, error: "Sign in to recap a trade." };
  }

  const cooldownError = checkOpenAiActionCooldown(
    user.id,
    `trade-recap:${id}`,
    OPENAI_COOLDOWN_MS.tradeRecap,
  );
  if (cooldownError) {
    return { ok: false, error: cooldownError };
  }

  const { data: tradeRow, error: tradeError } = await supabase
    .from("trades")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (tradeError) {
    return { ok: false, error: tradeError.message };
  }
  if (!tradeRow) {
    return { ok: false, error: "Trade not found." };
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

  const trade = tradeRow as Trade;
  let inTradePeak = null;
  let profitTakePath = null;
  let lossCutPath = null;
  if (trade.entry_time) {
    const windowEnd = trade.exit_time ?? new Date().toISOString();
    const { data: priceRows, error: priceError } = await supabase
      .from("predictions")
      .select("price, created_at")
      .eq("symbol", trade.symbol)
      .gte("created_at", trade.entry_time)
      .lte("created_at", windowEnd)
      .not("price", "is", null);
    if (!priceError && priceRows?.length) {
      const ticks = priceRows
        .map((row) => ({
          price: Number(row.price),
          created_at: String(row.created_at),
        }))
        .filter((row) => Number.isFinite(row.price)) as PriceTick[];
      profitTakePath = computeProfitTakePathStats(trade, ticks, settings);
      lossCutPath = computeLossCutPathStats(trade, ticks, settings);
      if (closedTradeIsLoss(trade)) {
        inTradePeak = computeInTradePeak(trade, ticks);
      }
    }
  }

  const packet = buildTradeRecapPacket(
    trade,
    settings,
    inTradePeak,
    profitTakePath,
    lossCutPath,
  );

  try {
    const result = await generateTradeRecap(packet);
    return { ok: true, recap: result.recap };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OpenAI request failed.",
    };
  }
}
