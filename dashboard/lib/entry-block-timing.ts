import type { Settings } from "@/lib/types/database";

export function blockExpiryMinutes(settings: Settings): number {
  return Math.max(1, settings.watchlist_rotation_interval_minutes ?? 15);
}

export function normalizeEntryBlockedAt(
  raw: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const symbol = key.trim().toUpperCase();
    if (!symbol || !value) continue;
    out[symbol] = value;
  }
  return out;
}

export function msUntilBlockExpires(
  blockedAtIso: string | undefined,
  expiryMinutes: number,
  nowMs: number = Date.now(),
): number | null {
  if (!blockedAtIso) return 0;
  const blockedMs = Date.parse(blockedAtIso);
  if (!Number.isFinite(blockedMs)) return 0;
  const expiresMs = blockedMs + expiryMinutes * 60_000;
  return Math.max(0, expiresMs - nowMs);
}

export function msUntilNextRotation(
  lastRotationAtIso: string | null | undefined,
  intervalMinutes: number,
  nowMs: number = Date.now(),
): number | null {
  if (!lastRotationAtIso) return 0;
  const lastMs = Date.parse(lastRotationAtIso);
  if (!Number.isFinite(lastMs)) return 0;
  const nextMs = lastMs + intervalMinutes * 60_000;
  return Math.max(0, nextMs - nowMs);
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
