import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { SkipExplainPacket } from "@/lib/skip-explainer/packet";
import {
  parseSkipExplanationText,
  SKIP_EXPLANATION_JSON_SCHEMA,
  type SkipExplanation,
} from "@/lib/skip-explainer/schema";

const SYSTEM_PROMPT = `You explain why a paper day-trading bot skipped one prediction.

Rules:
- Use plain language for someone new to trading bots. Say "the bot" and "Jev".
- Use the percents already in the JSON packet. Do not invent prices, headlines, counts, or other skips.
- summary is 2–3 sentences. what_blocked_it is one sentence naming the stored skip reason.
- If jev_was_called is false, Jev did not run; zeros are placeholders. Say the entry filter blocked before Jev. Use closeness hard_block. Never claim Jev scored or recorded confidence.
- closeness:
  - near_miss: Jev was close to a buy (confidence, margin, or confirmation still counting) and a gate stopped it.
  - hard_block: a filter, risk rule, broker check, or already-open position stopped it even if Jev liked it.
  - not_a_signal: HOLD or SELL was dominant, or BUY was far below the record threshold (only when jev_was_called is true).
- gates.settings fields are the bot's current dashboard settings; they may differ from when this prediction was stored.
- This is an explanation only. Do not promise profit or say to enable live trading.`;

export async function generateSkipExplanation(
  packet: SkipExplainPacket,
): Promise<{ explanation: SkipExplanation; model: string }> {
  const { output, model } = await runStructured({
    name: "skip_explanation",
    schema: SKIP_EXPLANATION_JSON_SCHEMA,
    parse: parseSkipExplanationText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: 600,
    outputLabel: "an explanation",
  });
  return { explanation: output, model };
}
