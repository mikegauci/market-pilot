import { isStringArray, parseJsonText } from "@/lib/openai/parse-json-text";

export type MorningBriefName = {
  symbol: string;
  note: string;
};

export type MorningBrief = {
  headline: string;
  names_to_watch: MorningBriefName[];
  picky_today: string[];
  caveats: string[];
};

export const MORNING_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    names_to_watch: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string" },
          note: { type: "string" },
        },
        required: ["symbol", "note"],
      },
    },
    picky_today: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "names_to_watch", "picky_today", "caveats"],
} as const;

function isNames(value: unknown): value is MorningBriefName[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as MorningBriefName;
    return typeof row.symbol === "string" && typeof row.note === "string";
  });
}

export function parseMorningBrief(value: unknown): MorningBrief {
  if (!value || typeof value !== "object") {
    throw new Error("Morning brief must be a JSON object.");
  }
  const row = value as MorningBrief;
  if (typeof row.headline !== "string" || !row.headline.trim()) {
    throw new Error("Morning brief headline is missing.");
  }
  if (!isNames(row.names_to_watch)) {
    throw new Error("Morning brief names_to_watch is invalid.");
  }
  if (!isStringArray(row.picky_today)) {
    throw new Error("Morning brief picky_today must be a string array.");
  }
  if (!isStringArray(row.caveats)) {
    throw new Error("Morning brief caveats must be a string array.");
  }
  return {
    headline: row.headline.trim(),
    names_to_watch: row.names_to_watch.map((item) => ({
      symbol: item.symbol.trim().toUpperCase(),
      note: item.note.trim(),
    })),
    picky_today: row.picky_today,
    caveats: row.caveats,
  };
}

export function constrainMorningBrief(
  brief: MorningBrief,
  allowedSymbols: ReadonlySet<string>,
): MorningBrief {
  return {
    ...brief,
    names_to_watch: brief.names_to_watch.filter(
      (row) => row.symbol && row.note && allowedSymbols.has(row.symbol),
    ),
  };
}

export function parseMorningBriefText(content: string): MorningBrief {
  return parseJsonText(content, "morning brief", parseMorningBrief);
}
