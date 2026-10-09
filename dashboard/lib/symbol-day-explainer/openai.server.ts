import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { SymbolDayExplainPacket } from "@/lib/symbol-day-explainer/packet";
import {
  parseSymbolDayExplanationText,
  SYMBOL_DAY_EXPLANATION_JSON_SCHEMA,
  type SymbolDayExplanation,
} from "@/lib/symbol-day-explainer/schema";

const SYSTEM_PROMPT = `You explain why a day-trading bot did or did not trade one symbol during the session.

Rules:
- Plain language for beginners. Use only skip counts and sample rows in the packet.
- headline under 15 words. summary is 2–3 sentences.
- main_blockers: up to 3 short bullets naming the top skip themes (use labels provided).
- Do not invent trades or skip reasons. Advisory only.`;

export async function generateSymbolDayExplanation(
  packet: SymbolDayExplainPacket,
): Promise<{ explanation: SymbolDayExplanation; model: string }> {
  const { output, model } = await runStructured({
    name: "symbol_day_explanation",
    schema: SYMBOL_DAY_EXPLANATION_JSON_SCHEMA,
    parse: parseSymbolDayExplanationText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: 700,
    outputLabel: "a symbol summary",
  });
  return { explanation: output, model };
}
