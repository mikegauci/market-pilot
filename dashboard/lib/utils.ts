import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(value: string | number) {
  return String(value).padStart(2, "0");
}

/**
 * Assemble timestamps manually. Node and browsers disagree on en-GB Intl output
 * (e.g. "28 Sept, 21:59:02" vs "28 Sep at 21:59:02"), which breaks SSR hydration.
 */
function localDateTimeParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: date.getDate(),
    month: SHORT_MONTHS[date.getMonth()],
    monthNum: date.getMonth() + 1,
    year: date.getFullYear(),
    hour: pad2(date.getHours()),
    minute: pad2(date.getMinutes()),
    second: pad2(date.getSeconds()),
  };
}

export function formatDateTime(value: string | null | undefined) {
  const parts = value ? localDateTimeParts(value) : null;
  if (!parts) return "—";
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Local time only — fixed format for compact UI and SSR hydration. */
export function formatTimeHms(value: string | null | undefined) {
  const parts = value ? localDateTimeParts(value) : null;
  if (!parts) return "—";
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Full local timestamp with fixed separators — safe for SSR hydration. */
export function formatDateTimeFull(value: string | null | undefined) {
  const parts = value ? localDateTimeParts(value) : null;
  if (!parts) return "—";
  return `${pad2(parts.day)}/${pad2(parts.monthNum)}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}
