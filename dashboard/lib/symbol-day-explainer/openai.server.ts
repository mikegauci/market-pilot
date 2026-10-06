import "server-only";

import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";
import { openAiBriefModel, requireOpenAiKey } from "@/lib/session-brief/openai.server";
import type { SymbolDayExplainPacket } from "@/lib/symbol-day-explainer/packet";
import {
  parseSymbolDayExplanation,
  SYMBOL_DAY_EXPLANATION_JSON_SCHEMA,
  type SymbolDayExplanation,
} from "@/lib/symbol-day-explainer/schema";

const SYSTEM_PROMPT = `You explain why a day-trading bot did or did not trade one symbol during the session.

Rules:
- Plain language for beginners. Use only skip counts and sample rows in the packet.
- headline under 15 words. summary is 2–3 sentences.
- main_blockers: up to 3 short bullets naming the top skip themes (use labels provided).
- Do not invent trades or skip reasons. Advisory only.`;

const symbolDayExplanationTextFormat = makeParseableTextFormat(
  {
    type: "json_schema",
    name: "symbol_day_explanation",
    schema: SYMBOL_DAY_EXPLANATION_JSON_SCHEMA,
    strict: true,
  },
  parseSymbolDayExplanation,
);

export async function generateSymbolDayExplanation(
  packet: SymbolDayExplainPacket,
): Promise<{ explanation: SymbolDayExplanation; model: string }> {
  const client = new OpenAI({ apiKey: requireOpenAiKey() });
  const model = openAiBriefModel();

  const response = await client.responses.parse({
    model,
    max_output_tokens: 700,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(packet) },
    ],
    text: { format: symbolDayExplanationTextFormat },
  });

  if (response.error) {
    throw new Error(response.error.message ?? "OpenAI request failed.");
  }

  const explanation = response.output_parsed;
  if (!explanation) {
    throw new Error("OpenAI did not return a symbol summary. Try again.");
  }

  return { explanation, model };
}
