export type WatchlistRotationHistoryEntry = {
  at: string;
  added?: string[];
  removed?: string[];
  /** Non-swap events (unblock, trim blocked, etc.) */
  detail?: string;
  /** Swap made by a breakout promotion rather than the scheduled rotation. */
  breakout?: boolean;
  /** When the breakout window ends (ISO). Older entries may not have it. */
  breakoutUntil?: string;
};

const MAX_HISTORY = 30;

export function normalizeWatchlistRotationHistory(
  raw: unknown,
): WatchlistRotationHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchlistRotationHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const at = typeof row.at === "string" ? row.at : "";
    if (!at) continue;
    const entry: WatchlistRotationHistoryEntry = { at };
    if (Array.isArray(row.added)) {
      entry.added = row.added
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.toUpperCase());
    }
    if (Array.isArray(row.removed)) {
      entry.removed = row.removed
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.toUpperCase());
    }
    if (typeof row.detail === "string" && row.detail.trim()) {
      entry.detail = row.detail.trim();
    }
    if (entry.detail === "breakout") {
      entry.breakout = true;
      if (typeof row.breakout_until === "string" && row.breakout_until.trim()) {
        entry.breakoutUntil = row.breakout_until.trim();
      }
    }
    if (entry.added?.length || entry.removed?.length || entry.detail) {
      out.push(entry);
    }
  }
  return out;
}

/** Parse legacy bot notes: `in A, B / out C` or `added … · removed …`. */
export function parseWatchlistRotationNote(
  note: string,
): Pick<WatchlistRotationHistoryEntry, "added" | "removed" | "detail"> | null {
  const trimmed = note.trim();
  if (!trimmed || trimmed === "no change") return null;

  const legacy = /^in\s+(.+?)\s+\/\s+out\s+(.+)$/i.exec(trimmed);
  if (legacy) {
    const parseList = (part: string) =>
      part.trim() === "-"
        ? []
        : part
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
    return { added: parseList(legacy[1]), removed: parseList(legacy[2]) };
  }

  const addedMatch = /added\s+(.+?)(?:\s·\s|$)/i.exec(trimmed);
  const removedMatch = /removed\s+(.+?)(?:\s·\s|$)/i.exec(trimmed);
  if (addedMatch || removedMatch) {
    const parseTail = (part: string | undefined) =>
      part
        ? part
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [];
    return {
      added: parseTail(addedMatch?.[1]),
      removed: parseTail(removedMatch?.[1]),
    };
  }

  if (/^unblocked\s+/i.test(trimmed)) {
    return { detail: trimmed.charAt(0).toUpperCase() + trimmed.slice(1) };
  }
  if (/^removed blocked symbols/i.test(trimmed)) {
    return { detail: "Removed blocked symbols from the active list" };
  }

  return { detail: trimmed };
}

export function prependWatchlistRotationHistory(
  existing: WatchlistRotationHistoryEntry[],
  entry: WatchlistRotationHistoryEntry,
): WatchlistRotationHistoryEntry[] {
  return [entry, ...existing].slice(0, MAX_HISTORY);
}

export function formatSymbolList(symbols: string[] | undefined): string | null {
  if (!symbols?.length) return null;
  return symbols.join(", ");
}

export function latestRotationChange(
  history: WatchlistRotationHistoryEntry[],
  lastNote: string,
  lastAt: string | null | undefined,
): WatchlistRotationHistoryEntry | null {
  if (history.length) return history[0] ?? null;
  const parsed = parseWatchlistRotationNote(lastNote);
  if (!parsed) return null;
  const at = lastAt?.trim() || new Date(0).toISOString();
  return { at, ...parsed };
}

/**
 * Symbols still inside a breakout window, mapped to when the window ends (ms).
 * Entries saved before the trader recorded `breakout_until` fall back to `at + windowMinutes`.
 */
export function activeBreakoutWindows(
  history: WatchlistRotationHistoryEntry[],
  nowMs: number,
  windowMinutes: number,
): Map<string, number> {
  const windows = new Map<string, number>();
  for (const entry of history) {
    if (!entry.breakout || !entry.added?.length) continue;
    const untilMs = entry.breakoutUntil
      ? Date.parse(entry.breakoutUntil)
      : Date.parse(entry.at) + windowMinutes * 60_000;
    if (!Number.isFinite(untilMs) || untilMs <= nowMs) continue;
    for (const symbol of entry.added) {
      const key = symbol.toUpperCase();
      if (!windows.has(key)) windows.set(key, untilMs);
    }
  }
  return windows;
}
