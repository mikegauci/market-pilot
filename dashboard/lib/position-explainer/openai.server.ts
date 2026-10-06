import "server-only";

import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";
import { openAiBriefModel, requireOpenAiKey } from "@/lib/session-brief/openai.server";
import type { PositionExplainPacket } from "@/lib/position-explainer/packet";
import {
  parsePositionExplanation,
  POSITION_EXPLANATION_JSON_SCHEMA,
  type PositionExplanation,
} from "@/lib/position-explainer/schema";

const SYSTEM_PROMPT = `You explain an open paper-trading position for someone new to bots.

Rules:
- Say "the bot" and "Jev". Use percents from the JSON as given.
- headline: under 15 words. jev_summary: what Jev last said for this symbol.
- next_exit: which exit rule is closest (stop, take profit, max hold, Jev SELL) using exit_rules.
- story: 2 sentences on whether the trade still matches the entry idea.
- Advisory only. Do not recommend live trading or promise profit.`;

const positionExplanationTextFormat = makeParseableTextFormat(
  {
    type: "json_schema",
    name: "position_explanation",
    schema: POSITION_EXPLANATION_JSON_SCHEMA,
    strict: true,
  },
  parsePositionExplanation,
);

export async function generatePositionExplanation(
  packet: PositionExplainPacket,
): Promise<{ explanation: PositionExplanation; model: string }> {
  const client = new OpenAI({ apiKey: requireOpenAiKey() });
  const model = openAiBriefModel();

  const response = await client.responses.parse({
    model,
    max_output_tokens: 700,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(packet) },
    ],
    text: { format: positionExplanationTextFormat },
  });

  if (response.error) {
    throw new Error(response.error.message ?? "OpenAI request failed.");
  }

  const explanation = response.output_parsed;
  if (!explanation) {
    throw new Error("OpenAI did not return a position explanation. Try again.");
  }

  return { explanation, model };
}
