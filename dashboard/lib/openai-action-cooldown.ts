/** Best-effort per-user cooldown for OpenAI server actions (single Node instance). */

const lastCallMs = new Map<string, number>();

export function checkOpenAiActionCooldown(
  userId: string,
  actionKey: string,
  cooldownMs: number,
): string | null {
  const key = `${userId}:${actionKey}`;
  const last = lastCallMs.get(key) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < cooldownMs) {
    return "Please wait a few seconds before trying again.";
  }
  lastCallMs.set(key, Date.now());
  return null;
}

export const OPENAI_COOLDOWN_MS = {
  skipExplain: 3_000,
  settingsAiSummary: 12_000,
  positionExplain: 5_000,
  symbolDayExplain: 8_000,
  tradeRecap: 5_000,
} as const;
