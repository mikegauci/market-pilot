import "server-only";

import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";
import type { MorningBriefPacket } from "@/lib/morning-brief/packet";
import {
  MORNING_BRIEF_JSON_SCHEMA,
  parseMorningBriefText,
  type MorningBrief,
} from "@/lib/morning-brief/schema";
import { openAiBriefModel, requireOpenAiKey } from "@/lib/session-brief/openai.server";

const SYSTEM_PROMPT = `You write a short morning note for a paper day-trading bot dashboard.

Rules:
- Use plain language. Say "the bot" and "Jev".
- Use only the JSON packet. Do not invent headlines, symbols, prices, or trades.
- If headlines is empty or fresh_headline_count is 0, say there is no fresh company news and return names_to_watch as an empty array.
- names_to_watch: only symbols that appear on a headline in the packet. One sentence each, grounded in that headline, its tags, or its sentiment. At most 5 names.
- picky_today: which gates are on, in plain language. At most 4 bullets. Mention a gate only if the packet shows it is on (0 means off).
- caveats: at most 3. Advisory only. Never say to enable live trading or promise profit.
- Keep headline under 20 words.`;

const morningBriefTextFormat = makeParseableTextFormat(
  {
    type: "json_schema",
    name: "morning_brief",
    schema: MORNING_BRIEF_JSON_SCHEMA,
    strict: true,
  },
  parseMorningBriefText,
);

export async function generateMorningBriefFromPacket(
  packet: MorningBriefPacket,
): Promise<{ brief: MorningBrief; model: string }> {
  const client = new OpenAI({ apiKey: requireOpenAiKey() });
  const model = openAiBriefModel();

  const response = await client.responses.parse({
    model,
    max_output_tokens: 900,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(packet) },
    ],
    text: {
      format: morningBriefTextFormat,
    },
  });

  if (response.error) {
    throw new Error(response.error.message ?? "OpenAI request failed.");
  }

  const brief = response.output_parsed;
  if (!brief) {
    const status = "status" in response ? String(response.status) : "unknown";
    throw new Error(`OpenAI did not return a morning brief (status: ${status}). Try again.`);
  }

  return { brief, model };
}
