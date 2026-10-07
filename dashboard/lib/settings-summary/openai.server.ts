import "server-only";

import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";
import type { SettingsAiSummaryPacket } from "@/lib/settings-summary/packet";
import {
  parseSettingsAiSummaryText,
  SETTINGS_AI_SUMMARY_JSON_SCHEMA,
  type SettingsAiSummary,
} from "@/lib/settings-summary/schema";
import { openAiBriefModel, requireOpenAiKey } from "@/lib/session-brief/openai.server";

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

const settingsSummaryTextFormat = makeParseableTextFormat(
  {
    type: "json_schema",
    name: "settings_ai_summary",
    schema: SETTINGS_AI_SUMMARY_JSON_SCHEMA,
    strict: true,
  },
  parseSettingsAiSummaryText,
);

/** gpt-6-luna and similar models can exceed 1100 tokens on structured summaries with rotation watchlists. */
const SETTINGS_SUMMARY_MAX_OUTPUT_TOKENS = 2500;
const SETTINGS_SUMMARY_RETRY_MAX_OUTPUT_TOKENS = 4000;

function incompleteReason(response: OpenAI.Responses.Response): string | null {
  const details = response.incomplete_details;
  if (!details || typeof details !== "object" || !("reason" in details)) {
    return null;
  }
  const reason = details.reason;
  return typeof reason === "string" ? reason : null;
}

export async function generateSettingsAiSummaryFromPacket(
  packet: SettingsAiSummaryPacket,
): Promise<{ summary: SettingsAiSummary; model: string }> {
  const client = new OpenAI({ apiKey: requireOpenAiKey() });
  const model = openAiBriefModel();

  const request = (maxOutputTokens: number) =>
    client.responses.parse({
      model,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(packet) },
      ],
      text: {
        format: settingsSummaryTextFormat,
      },
    });

  let response = await request(SETTINGS_SUMMARY_MAX_OUTPUT_TOKENS);

  if (
    !response.output_parsed &&
    response.status === "incomplete" &&
    incompleteReason(response) === "max_output_tokens"
  ) {
    response = await request(SETTINGS_SUMMARY_RETRY_MAX_OUTPUT_TOKENS);
  }

  if (response.error) {
    throw new Error(response.error.message ?? "OpenAI request failed.");
  }

  const summary = response.output_parsed;
  if (!summary) {
    const status = "status" in response ? String(response.status) : "unknown";
    const reason = incompleteReason(response);
    const detail =
      reason === "max_output_tokens"
        ? " The model ran out of output space — try again or set OPENAI_BRIEF_MODEL to gpt-4o-mini."
        : reason
          ? ` (${reason})`
          : "";
    throw new Error(
      `OpenAI did not return a settings summary (status: ${status})${detail} Try again.`,
    );
  }

  return { summary, model };
}
