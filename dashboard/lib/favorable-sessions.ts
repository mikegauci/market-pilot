import { ANALYTICS_CALIBRATION_LOOKBACK_DAYS } from "@/lib/analytics-data";
import type { PortfolioRange } from "@/lib/portfolio-analytics";

/** A session day is "mostly favourable" when at least this share of sampled minutes is favourable. */
export const MOSTLY_FAVORABLE_MIN_PCT = 50;

export const FAVORABLE_SESSION_EMPTY =
  "No session in this range was favourable for most of the open hours.";

const NEW_YORK = "America/New_York";

export type FavorableSessionRow = {
  sessionDate: string;
  favorableMinutes: number;
  sampledMinutes: number;
  /** Rounded share of sampled minutes, 0–100. */
  favorablePct: number;
};

export type FavorableSessionFetch = {
  rows: FavorableSessionRow[];
  error: string | null;
};

export type FavorableSessionDayLine = {
  sessionDate: string;
  text: string;
};

export type FavorableSessionNote = {
  mostlyFavorable: FavorableSessionDayLine[];
  todayText: string | null;
};

export const EMPTY_FAVORABLE_SESSIONS: FavorableSessionFetch = {
  rows: [],
  error: null,
};

export function lookbackDaysForRange(range: PortfolioRange): number {
  switch (range) {
    case "1d":
      return 1;
    case "1w":
      return 7;
    case "1m":
      return 30;
    case "all":
      return ANALYTICS_CALIBRATION_LOOKBACK_DAYS;
  }
}

export function roundedFavorablePercent(
  favorableMinutes: number,
  sampledMinutes: number,
): number {
  if (sampledMinutes <= 0) return 0;
  return Math.round((favorableMinutes / sampledMinutes) * 100);
}

export function newYorkCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatSessionDate(isoDate: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${isoDate}T12:00:00Z`));
  return formatted.replace(",", "");
}

export function mapFavorableSessionRpcRows(data: unknown): FavorableSessionRow[] {
  if (!Array.isArray(data)) return [];
  const rows: FavorableSessionRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sessionDate = String(row.session_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) continue;
    const favorableMinutes = Number(row.favorable_minutes);
    const sampledMinutes = Number(row.sampled_minutes);
    if (!Number.isFinite(favorableMinutes) || !Number.isFinite(sampledMinutes)) continue;
    rows.push({
      sessionDate,
      favorableMinutes,
      sampledMinutes,
      favorablePct: roundedFavorablePercent(favorableMinutes, sampledMinutes),
    });
  }
  return rows;
}

function dayLine(row: FavorableSessionRow, soFar: boolean): string {
  const suffix = soFar ? " so far" : "";
  return `${formatSessionDate(row.sessionDate)} — ${row.favorablePct}% of the session${suffix}`;
}

/**
 * Days at or above the mostly-favourable cutoff, newest first.
 * Today is eligible before the session closes; its share uses minutes so far.
 */
export function buildFavorableSessionNote(
  rows: FavorableSessionRow[],
  now: Date = new Date(),
): FavorableSessionNote {
  const today = newYorkCalendarDate(now);
  const sorted = rows
    .filter((row) => row.sampledMinutes > 0)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));

  const mostlyFavorable = sorted
    .filter((row) => row.favorablePct >= MOSTLY_FAVORABLE_MIN_PCT)
    .map((row) => ({
      sessionDate: row.sessionDate,
      text: dayLine(row, row.sessionDate === today),
    }));

  const todayRow = sorted.find((row) => row.sessionDate === today) ?? null;
  const todayText = todayRow
    ? `Today so far: ${todayRow.favorablePct}% of the session was favourable.`
    : null;

  return { mostlyFavorable, todayText };
}
