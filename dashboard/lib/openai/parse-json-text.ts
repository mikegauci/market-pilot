/** Shared parsing for structured OpenAI replies (also safe to import from tests and client code). */

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Trim, JSON-parse and validate model output. `label` is a noun like "trade recap";
 * `unreadableMessage` overrides the default "could not read" error.
 */
export function parseJsonText<T>(
  content: string,
  label: string,
  validate: (value: unknown) => T,
  unreadableMessage?: string,
): T {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`OpenAI returned an empty ${label}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const article = /^[aeiou]/i.test(label) ? "an" : "a";
    throw new Error(
      unreadableMessage ?? `OpenAI returned ${article} ${label} we could not read. Try again.`,
    );
  }
  return validate(parsed);
}
