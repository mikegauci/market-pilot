import { isStringArray, parseJsonText } from "@/lib/openai/parse-json-text";

export type SettingsAiSummary = {
  headline: string;
  jev_and_signals: string[];
  risk_and_limits: string[];
  exits_and_filters: string[];
  watchlist: string[];
  /** One sentence on built-in trader gates (.env), or empty string if nothing to add. */
  trader_only_note: string;
};

export const SETTINGS_AI_SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    jev_and_signals: { type: "array", items: { type: "string" } },
    risk_and_limits: { type: "array", items: { type: "string" } },
    exits_and_filters: { type: "array", items: { type: "string" } },
    watchlist: { type: "array", items: { type: "string" } },
    trader_only_note: { type: "string" },
  },
  required: [
    "headline",
    "jev_and_signals",
    "risk_and_limits",
    "exits_and_filters",
    "watchlist",
    "trader_only_note",
  ],
} as const;

const MAX_BULLETS = 4;

function trimBullets(items: string[]): string[] {
  return items
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_BULLETS);
}

export function parseSettingsAiSummary(value: unknown): SettingsAiSummary {
  if (!value || typeof value !== "object") {
    throw new Error("Settings summary must be a JSON object.");
  }
  const row = value as SettingsAiSummary;
  if (typeof row.headline !== "string" || !row.headline.trim()) {
    throw new Error("Settings summary headline is missing.");
  }
  if (!isStringArray(row.jev_and_signals)) {
    throw new Error("Settings summary jev_and_signals is invalid.");
  }
  if (!isStringArray(row.risk_and_limits)) {
    throw new Error("Settings summary risk_and_limits is invalid.");
  }
  if (!isStringArray(row.exits_and_filters)) {
    throw new Error("Settings summary exits_and_filters is invalid.");
  }
  if (!isStringArray(row.watchlist)) {
    throw new Error("Settings summary watchlist is invalid.");
  }
  if (typeof row.trader_only_note !== "string") {
    throw new Error("Settings summary trader_only_note is invalid.");
  }

  return {
    headline: row.headline.trim(),
    jev_and_signals: trimBullets(row.jev_and_signals),
    risk_and_limits: trimBullets(row.risk_and_limits),
    exits_and_filters: trimBullets(row.exits_and_filters),
    watchlist: trimBullets(row.watchlist),
    trader_only_note: row.trader_only_note.trim(),
  };
}

export function parseSettingsAiSummaryText(content: string): SettingsAiSummary {
  return parseJsonText(content, "settings summary", parseSettingsAiSummary);
}
