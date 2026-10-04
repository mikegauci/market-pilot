import type { SessionBriefRow } from "@/lib/types/database";

export type SessionBriefDay = {
  session_date: string;
  prediction_count: number;
};

export type SessionBriefHistoryEntry = SessionBriefDay & {
  brief: SessionBriefRow | null;
};

export function parseSessionBriefDays(value: unknown): SessionBriefDay[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as { session_date?: string; prediction_count?: number };
      if (!item.session_date) return null;
      return {
        session_date: item.session_date,
        prediction_count: Number(item.prediction_count) || 0,
      };
    })
    .filter((row): row is SessionBriefDay => row != null);
}

/** Latest saved brief per session date (newest generation wins). */
export function indexBriefsBySessionDate(
  briefs: SessionBriefRow[],
): Map<string, SessionBriefRow> {
  const map = new Map<string, SessionBriefRow>();
  for (const brief of briefs) {
    const existing = map.get(brief.session_date);
    if (!existing || brief.created_at > existing.created_at) {
      map.set(brief.session_date, brief);
    }
  }
  return map;
}

export function buildSessionBriefHistory(
  days: SessionBriefDay[],
  briefs: SessionBriefRow[],
): SessionBriefHistoryEntry[] {
  const byDate = indexBriefsBySessionDate(briefs);
  return days.map((day) => ({
    ...day,
    brief: byDate.get(day.session_date) ?? null,
  }));
}

export function defaultSelectedSessionDate(
  history: SessionBriefHistoryEntry[],
  preferredFirst = true,
): string | null {
  if (history.length === 0) return null;
  if (preferredFirst) {
    const oldest = history[history.length - 1];
    return oldest?.session_date ?? null;
  }
  return history[0]?.session_date ?? null;
}
