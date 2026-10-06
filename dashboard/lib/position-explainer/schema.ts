export type PositionExplanation = {
  headline: string;
  jev_summary: string;
  next_exit: string;
  story: string;
};

export const POSITION_EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    jev_summary: { type: "string" },
    next_exit: { type: "string" },
    story: { type: "string" },
  },
  required: ["headline", "jev_summary", "next_exit", "story"],
} as const;

export function parsePositionExplanation(value: unknown): PositionExplanation {
  if (!value || typeof value !== "object") {
    throw new Error("Position explanation must be a JSON object.");
  }
  const row = value as PositionExplanation;
  for (const key of ["headline", "jev_summary", "next_exit", "story"] as const) {
    if (typeof row[key] !== "string" || !row[key].trim()) {
      throw new Error(`Position explanation ${key} is missing.`);
    }
  }
  return {
    headline: row.headline.trim(),
    jev_summary: row.jev_summary.trim(),
    next_exit: row.next_exit.trim(),
    story: row.story.trim(),
  };
}
