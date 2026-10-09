import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { SessionBriefPacket } from "@/lib/session-brief/packet";
import { parseBriefFromModelText } from "@/lib/session-brief/parse-brief-text";
import {
  SESSION_BRIEF_JSON_SCHEMA,
  type SessionBrief,
} from "@/lib/session-brief/schema";

const SYSTEM_PROMPT = `You write session reviews for a paper day-trading bot dashboard.

Rules:
- Use plain language for someone new to trading bots. Say "the bot" and "Jev" (the prediction model).
- Use percent for probabilities (e.g. 85%), not decimals.
- Summarize only what is in the JSON packet. Do not invent trades or skip counts.
- entry_blockers counts must match skip_reason totals from the packet (top reasons only).
- Near-miss and eligible-blocked examples come from stored trade_skip_reason on predictions (historical).
- settings in the packet are from when this brief was generated; mention that if you reference thresholds.
- suggestions are advisory only: never say to enable live trading or promise profit.
- suggestions.setting must be one of: minimum_jev_confidence, signal_record_threshold, stop_loss_percentage, take_profit_percentage, max_hold_minutes, max_open_positions, min_volume_ratio, reentry_cooldown_minutes.
- direction is raise, lower, or keep. Do not pick a new number. The dashboard applies a small step.
- Use "tended to", "on average", and "sanity check" where appropriate.
- Keep headline under 20 words. Limit what_happened to 3–5 bullets, suggestions to at most 3.`;

export async function generateSessionBriefFromPacket(
  packet: SessionBriefPacket,
): Promise<{ brief: SessionBrief; model: string }> {
  const { output, model } = await runStructured({
    name: "session_brief",
    schema: SESSION_BRIEF_JSON_SCHEMA,
    parse: parseBriefFromModelText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: 2500,
    outputLabel: "a complete brief",
    retryHint: "Try Regenerate.",
  });
  return { brief: output, model };
}
