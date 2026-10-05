export type SessionBriefSuggestion = {
  setting: string;
  direction: "raise" | "lower" | "keep";
  why: string;
};

export type SessionBriefEntryBlocker = {
  reason: string;
  count: number;
  takeaway: string;
};

export type SessionBrief = {
  headline: string;
  what_happened: string[];
  entry_blockers: SessionBriefEntryBlocker[];
  exits: string[];
  suggestions: SessionBriefSuggestion[];
  caveats: string[];
};

export const SESSION_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    what_happened: { type: "array", items: { type: "string" } },
    entry_blockers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: { type: "string" },
          count: { type: "integer" },
          takeaway: { type: "string" },
        },
        required: ["reason", "count", "takeaway"],
      },
    },
    exits: { type: "array", items: { type: "string" } },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          setting: {
            type: "string",
            enum: [
              "minimum_jev_confidence",
              "signal_record_threshold",
              "stop_loss_percentage",
              "take_profit_percentage",
              "max_hold_minutes",
              "max_open_positions",
              "min_volume_ratio",
              "reentry_cooldown_minutes",
            ],
          },
          direction: { type: "string", enum: ["raise", "lower", "keep"] },
          why: { type: "string" },
        },
        required: ["setting", "direction", "why"],
      },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: [
    "headline",
    "what_happened",
    "entry_blockers",
    "exits",
    "suggestions",
    "caveats",
  ],
} as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEntryBlockers(value: unknown): value is SessionBriefEntryBlocker[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as SessionBriefEntryBlocker).reason === "string" &&
      typeof (item as SessionBriefEntryBlocker).count === "number" &&
      Number.isFinite((item as SessionBriefEntryBlocker).count) &&
      typeof (item as SessionBriefEntryBlocker).takeaway === "string",
  );
}

function isSuggestions(value: unknown): value is SessionBriefSuggestion[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as SessionBriefSuggestion;
    return (
      typeof row.setting === "string" &&
      (row.direction === "raise" ||
        row.direction === "lower" ||
        row.direction === "keep") &&
      typeof row.why === "string"
    );
  });
}

export function parseSessionBrief(value: unknown): SessionBrief {
  if (!value || typeof value !== "object") {
    throw new Error("Brief must be a JSON object.");
  }
  const row = value as SessionBrief;
  if (typeof row.headline !== "string" || !row.headline.trim()) {
    throw new Error("Brief headline is missing.");
  }
  if (!isStringArray(row.what_happened)) {
    throw new Error("Brief what_happened must be a string array.");
  }
  if (!isEntryBlockers(row.entry_blockers)) {
    throw new Error("Brief entry_blockers is invalid.");
  }
  if (!isStringArray(row.exits)) {
    throw new Error("Brief exits must be a string array.");
  }
  if (!isSuggestions(row.suggestions)) {
    throw new Error("Brief suggestions is invalid.");
  }
  if (!isStringArray(row.caveats)) {
    throw new Error("Brief caveats must be a string array.");
  }
  return row;
}
