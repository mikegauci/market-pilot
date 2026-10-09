import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { MorningBriefPacket } from "@/lib/morning-brief/packet";
import {
  MORNING_BRIEF_JSON_SCHEMA,
  parseMorningBriefText,
  type MorningBrief,
} from "@/lib/morning-brief/schema";

const SYSTEM_PROMPT = `You write a short morning note for a paper day-trading bot dashboard.

Rules:
- Use plain language. Say "the bot" and "Jev".
- Use only the JSON packet. Do not invent headlines, symbols, prices, or trades.
- If headlines is empty or fresh_headline_count is 0, say there is no fresh company news and return names_to_watch as an empty array.
- names_to_watch: only symbols that appear on a headline in the packet. One sentence each, grounded in that headline, its tags, or its sentiment. At most 5 names.
- picky_today: which gates are on, in plain language. At most 4 bullets. Mention a gate only if the packet shows it is on (0 means off).
- caveats: at most 3. Advisory only. Never say to enable live trading or promise profit.
- Keep headline under 20 words.`;

export async function generateMorningBriefFromPacket(
  packet: MorningBriefPacket,
): Promise<{ brief: MorningBrief; model: string }> {
  const { output, model } = await runStructured({
    name: "morning_brief",
    schema: MORNING_BRIEF_JSON_SCHEMA,
    parse: parseMorningBriefText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: 900,
    outputLabel: "a morning brief",
  });
  return { brief: output, model };
}
