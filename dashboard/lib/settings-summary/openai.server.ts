import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { SettingsAiSummaryPacket } from "@/lib/settings-summary/packet";
import {
  parseSettingsAiSummaryText,
  SETTINGS_AI_SUMMARY_JSON_SCHEMA,
  type SettingsAiSummary,
} from "@/lib/settings-summary/schema";

const SYSTEM_PROMPT = `You write a brief, structured summary of the user's current trading bot Settings for the dashboard.

Rules:
- Plain language for someone who runs the bot but is not a quant. Say "the bot" and "Jev".
- Use only the JSON packet. Do not invent symbols, trades, or numbers not in the packet.
- headline: one sentence, under 18 words, capturing how picky vs active the setup feels.
- Each section array: at most 4 short bullets. Start bullets with the idea, not "The bot..." every time.
- jev_and_signals: confidence, confirmation, signal recording — how hard Jev must agree before entry.
- risk_and_limits: position sizing, stops, targets, hold time, daily loss, re-entry caps.
- exits_and_filters: soft exits, early profit/loss bands, volume/price/dollar volume, session rotation filter.
- watchlist: rotation on/off, how many names, blocked symbols, rotation cadence — mention symbols only from effective_symbols.
- trader_only_note: one sentence on important built-in gates from trader_built_in_gates if any are materially restrictive; otherwise "".
- Never tell the user to enable live trading or promise returns.`;

/** gpt-6-luna and similar models can exceed 1100 tokens on structured summaries with rotation watchlists. */
const SETTINGS_SUMMARY_MAX_OUTPUT_TOKENS = 2500;
const SETTINGS_SUMMARY_RETRY_MAX_OUTPUT_TOKENS = 4000;

export async function generateSettingsAiSummaryFromPacket(
  packet: SettingsAiSummaryPacket,
): Promise<{ summary: SettingsAiSummary; model: string }> {
  const { output, model } = await runStructured({
    name: "settings_ai_summary",
    schema: SETTINGS_AI_SUMMARY_JSON_SCHEMA,
    parse: parseSettingsAiSummaryText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: SETTINGS_SUMMARY_MAX_OUTPUT_TOKENS,
    retryMaxOutputTokens: SETTINGS_SUMMARY_RETRY_MAX_OUTPUT_TOKENS,
    outputLabel: "a settings summary",
  });
  return { summary: output, model };
}
