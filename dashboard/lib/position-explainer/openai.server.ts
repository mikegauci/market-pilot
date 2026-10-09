import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { PositionExplainPacket } from "@/lib/position-explainer/packet";
import {
  parsePositionExplanationText,
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

export async function generatePositionExplanation(
  packet: PositionExplainPacket,
): Promise<{ explanation: PositionExplanation; model: string }> {
  const { output, model } = await runStructured({
    name: "position_explanation",
    schema: POSITION_EXPLANATION_JSON_SCHEMA,
    parse: parsePositionExplanationText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: 700,
    outputLabel: "a position explanation",
  });
  return { explanation: output, model };
}
