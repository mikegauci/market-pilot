import { parseJsonText } from "@/lib/openai/parse-json-text";

export type SkipCloseness = "near_miss" | "hard_block" | "not_a_signal";

export type SkipExplanation = {
  summary: string;
  closeness: SkipCloseness;
  what_blocked_it: string;
};

export const SKIP_EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    closeness: {
      type: "string",
      enum: ["near_miss", "hard_block", "not_a_signal"],
    },
    what_blocked_it: { type: "string" },
  },
  required: ["summary", "closeness", "what_blocked_it"],
} as const;

const CLOSENESS: ReadonlySet<string> = new Set([
  "near_miss",
  "hard_block",
  "not_a_signal",
]);

export function parseSkipExplanation(value: unknown): SkipExplanation {
  if (!value || typeof value !== "object") {
    throw new Error("Explanation must be a JSON object.");
  }
  const row = value as SkipExplanation;
  if (typeof row.summary !== "string" || !row.summary.trim()) {
    throw new Error("Explanation summary is missing.");
  }
  if (typeof row.what_blocked_it !== "string" || !row.what_blocked_it.trim()) {
    throw new Error("Explanation is missing what blocked the trade.");
  }
  if (!CLOSENESS.has(row.closeness)) {
    throw new Error("Explanation closeness is invalid.");
  }
  return {
    summary: row.summary.trim(),
    closeness: row.closeness,
    what_blocked_it: row.what_blocked_it.trim(),
  };
}

export function parseSkipExplanationText(content: string): SkipExplanation {
  return parseJsonText(content, "explanation", parseSkipExplanation);
}
