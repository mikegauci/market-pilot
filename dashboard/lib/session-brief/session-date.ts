import { SESSION_BRIEF_FIRST_DATE } from "@/lib/session-brief/constants";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidSessionDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function assertSessionDateAllowed(
  sessionDate: string,
  latestSessionDate: string | null,
): string | null {
  if (!isValidSessionDate(sessionDate)) {
    return "Session date must be YYYY-MM-DD.";
  }
  if (sessionDate < SESSION_BRIEF_FIRST_DATE) {
    return `Session briefs start on ${SESSION_BRIEF_FIRST_DATE}.`;
  }
  if (latestSessionDate && sessionDate > latestSessionDate) {
    return `No prediction data for ${sessionDate} yet.`;
  }
  return null;
}
