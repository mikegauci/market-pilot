/** Best-effort rate limit for public viewer sign-in (single Node instance). */

const lastAttemptMs = new Map<string, number>();

const COOLDOWN_MS = 3_000;

export function checkViewerSignInCooldown(clientKey: string): string | null {
  const key = clientKey.trim() || "unknown";
  const last = lastAttemptMs.get(key) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < COOLDOWN_MS) {
    return "Please wait a few seconds before trying again.";
  }
  lastAttemptMs.set(key, Date.now());
  return null;
}
