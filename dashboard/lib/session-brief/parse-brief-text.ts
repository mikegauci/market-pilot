import { parseSessionBrief, type SessionBrief } from "@/lib/session-brief/schema";

export function parseBriefFromModelText(content: string): SessionBrief {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("OpenAI returned an empty brief.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "OpenAI returned a brief we could not read. Try Regenerate — if it keeps failing, try a shorter session or another model via OPENAI_BRIEF_MODEL.",
    );
  }
  return parseSessionBrief(parsed);
}
