import { parseJsonText } from "@/lib/openai/parse-json-text";

export type SymbolDayExplanation = {
  headline: string;
  summary: string;
  main_blockers: string[];
};

export const SYMBOL_DAY_EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    main_blockers: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "summary", "main_blockers"],
} as const;

export function parseSymbolDayExplanation(value: unknown): SymbolDayExplanation {
  if (!value || typeof value !== "object") {
    throw new Error("Symbol day explanation must be a JSON object.");
  }
  const row = value as SymbolDayExplanation;
  if (typeof row.headline !== "string" || !row.headline.trim()) {
    throw new Error("Symbol day headline is missing.");
  }
  if (typeof row.summary !== "string" || !row.summary.trim()) {
    throw new Error("Symbol day summary is missing.");
  }
  if (
    !Array.isArray(row.main_blockers) ||
    !row.main_blockers.every((item) => typeof item === "string")
  ) {
    throw new Error("Symbol day main_blockers must be strings.");
  }
  return {
    headline: row.headline.trim(),
    summary: row.summary.trim(),
    main_blockers: row.main_blockers.map((item) => item.trim()).filter(Boolean),
  };
}

export function parseSymbolDayExplanationText(content: string): SymbolDayExplanation {
  return parseJsonText(content, "symbol summary", parseSymbolDayExplanation);
}
