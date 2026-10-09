import { parseJsonText } from "@/lib/openai/parse-json-text";
import { parseSessionBrief, type SessionBrief } from "@/lib/session-brief/schema";

export function parseBriefFromModelText(content: string): SessionBrief {
  return parseJsonText(
    content,
    "brief",
    parseSessionBrief,
    "OpenAI returned a brief we could not read. Try Regenerate — if it keeps failing, try a shorter session or another model via OPENAI_BRIEF_MODEL.",
  );
}
