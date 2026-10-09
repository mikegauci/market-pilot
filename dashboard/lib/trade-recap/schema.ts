import { parseJsonText } from "@/lib/openai/parse-json-text";

export type TradeRecap = {
  headline: string;
  entry_story: string;
  exit_story: string;
  verdict: string;
};

export const TRADE_RECAP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    entry_story: { type: "string" },
    exit_story: { type: "string" },
    verdict: { type: "string" },
  },
  required: ["headline", "entry_story", "exit_story", "verdict"],
} as const;

export function parseTradeRecap(value: unknown): TradeRecap {
  if (!value || typeof value !== "object") {
    throw new Error("Trade recap must be a JSON object.");
  }
  const row = value as TradeRecap;
  for (const key of ["headline", "entry_story", "exit_story", "verdict"] as const) {
    if (typeof row[key] !== "string" || !row[key].trim()) {
      throw new Error(`Trade recap ${key} is missing.`);
    }
  }
  return {
    headline: row.headline.trim(),
    entry_story: row.entry_story.trim(),
    exit_story: row.exit_story.trim(),
    verdict: row.verdict.trim(),
  };
}

export function parseTradeRecapText(content: string): TradeRecap {
  return parseJsonText(content, "trade recap", parseTradeRecap);
}
