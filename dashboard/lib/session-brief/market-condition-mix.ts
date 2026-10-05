import type { MarketConditionLevel } from "@/lib/market-condition";

export const REGULAR_SESSION_MINUTES = 390;

export type SessionConditionMinutes = {
  session_date: string;
  favorable_minutes: number;
  caution_minutes: number;
  headwind_minutes: number;
  unknown_minutes: number;
  observed_minutes: number;
};

export type ConditionShare = {
  level: Exclude<MarketConditionLevel, "closed">;
  label: string;
  minutes: number;
  /** Whole percent. Null means the bucket has minutes but rounds below 1%. */
  percent: number | null;
};

type SessionConditionMinuteKey =
  | "favorable_minutes"
  | "caution_minutes"
  | "headwind_minutes"
  | "unknown_minutes";

const SHARE_ORDER: {
  level: ConditionShare["level"];
  label: string;
  key: SessionConditionMinuteKey;
}[] = [
  { level: "favorable", label: "Favorable", key: "favorable_minutes" },
  { level: "caution", label: "Caution", key: "caution_minutes" },
  { level: "headwind", label: "Headwind", key: "headwind_minutes" },
  { level: "unknown", label: "Unknown", key: "unknown_minutes" },
];

function asCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

export function parseSessionConditionMix(value: unknown): SessionConditionMinutes[] {
  if (!Array.isArray(value)) return [];
  const rows: SessionConditionMinutes[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<SessionConditionMinutes>;
    if (typeof row.session_date !== "string" || !row.session_date) continue;
    const favorable_minutes = asCount(row.favorable_minutes);
    const caution_minutes = asCount(row.caution_minutes);
    const headwind_minutes = asCount(row.headwind_minutes);
    const unknown_minutes = asCount(row.unknown_minutes);
    const observed = asCount(row.observed_minutes);
    rows.push({
      session_date: row.session_date.slice(0, 10),
      favorable_minutes,
      caution_minutes,
      headwind_minutes,
      unknown_minutes,
      observed_minutes:
        observed || favorable_minutes + caution_minutes + headwind_minutes + unknown_minutes,
    });
  }
  return rows;
}

/** Largest-remainder whole percents. Buckets that stay at 0% display as under 1%. */
export function sharesFromMinutes(
  row: Pick<
    SessionConditionMinutes,
    "favorable_minutes" | "caution_minutes" | "headwind_minutes" | "unknown_minutes"
  >,
): ConditionShare[] {
  const buckets = SHARE_ORDER.map((share) => ({
    level: share.level,
    label: share.label,
    minutes: row[share.key],
  })).filter((bucket) => bucket.minutes > 0);

  const total = buckets.reduce((sum, bucket) => sum + bucket.minutes, 0);
  if (total <= 0) return [];

  const drafted = buckets.map((bucket) => {
    const exact = (bucket.minutes / total) * 100;
    const floor = Math.floor(exact);
    return { ...bucket, floor, fraction: exact - floor };
  });

  let leftover = 100 - drafted.reduce((sum, bucket) => sum + bucket.floor, 0);
  const byFraction = [...drafted].sort((a, b) => b.fraction - a.fraction || b.minutes - a.minutes);
  for (const bucket of byFraction) {
    if (leftover <= 0) break;
    bucket.floor += 1;
    leftover -= 1;
  }

  return drafted.map((bucket) => ({
    level: bucket.level,
    label: bucket.label,
    minutes: bucket.minutes,
    percent: bucket.floor === 0 ? null : bucket.floor,
  }));
}

export function formatSharePercent(percent: number | null): string {
  return percent == null ? "<1%" : `${percent}%`;
}

export function formatConditionShareLine(shares: ConditionShare[]): string {
  return shares.map((share) => `${formatSharePercent(share.percent)} ${share.label}`).join(", ");
}

export function sessionConditionCoverageNote(observedMinutes: number): string {
  const recorded = observedMinutes.toLocaleString("en-US");
  const scope =
    "Each minute uses the median 5-minute move of symbols the bot evaluated then (watchlist and open positions, excluding the benchmark).";
  if (observedMinutes === REGULAR_SESSION_MINUTES) {
    return `Share of all ${recorded} minutes from 9:30 to 16:00 New York. ${scope}`;
  }
  return `Share of ${recorded} recorded minutes from 9:30 to 16:00 New York (full session is ${REGULAR_SESSION_MINUTES}). ${scope}`;
}
