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
- entry_blockers counts must match skip_reason totals from the packet (top reasons only). Set each entry_blockers.reason to the exact skip_reasons label from the packet.
- Near-miss and eligible-blocked examples come from stored trade_skip_reason on predictions (historical).
- missed_opportunities is a rough replay: for each skipped name, the packet checks 5-minute bars after the skip against the current stop-loss, take-profit and max-hold settings. Outcomes are take_profit, stop_loss, timed_out or no_data. It ignores fills and spread, so describe it as a rough check in percent moves. Never describe it as money made or lost. It uses the stop-loss, take-profit and max-hold settings from when this brief was generated, which may differ from the settings used that day.
- missed_opportunities_summary: at most 3 bullets on which skip reasons blocked names that would have reached take-profit or the stop, using by_reason counts. If most rows are no_data, say there were not enough price bars to tell.
- what_went_wrong: at most 3 items. Use trades.closed max_up_pct / max_down_pct (best and worst price reached after entry), exit reasons and trades.by_time_of_day. Examples: trades that went green then stopped out, entries that never went green, a weak time of day. Each item needs an issue and the numbers as evidence. If nothing clearly went wrong, return an empty array.
- Each suggestion needs evidence: the packet numbers behind it (for example "4 of 6 volume-blocked names reached take-profit in the replay"). If the evidence is thin, use direction keep.
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
    maxOutputTokens: 3500,
    outputLabel: "a complete brief",
    retryHint: "Try Regenerate.",
  });
  return { brief: output, model };
}
