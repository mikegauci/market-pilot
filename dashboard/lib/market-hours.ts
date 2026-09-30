import type { BotStatus } from "@/lib/types/database";

const ET = "America/New_York";
export const CHART_TIMEZONE = "Europe/Malta";
const MALTA = CHART_TIMEZONE;

export type MarketStatus = {
  isOpen: boolean;
  timeMalta: string;
  sessionLabel: string;
  minutesToClose: number | null;
  clockError: string | null;
};

function formatMaltaClock(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: MALTA,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );

  const hour = parts.hour ?? "00";
  const minute = parts.minute ?? "00";
  const second = parts.second ?? "00";

  return `${hour}:${minute}:${second}`;
}

function formatMaltaTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MALTA,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Prefer engine-published session clock on bot_status (holiday/early-close aware).
 * Falls back to closed + error when the engine has not published yet.
 */
export function getMarketStatusFromBot(
  bot: Pick<
    BotStatus,
    | "session_is_open"
    | "session_open_at"
    | "session_close_at"
    | "minutes_to_close"
    | "session_clock_error"
  > | null | undefined,
  date = new Date(),
): MarketStatus {
  const clockError = bot?.session_clock_error ?? null;
  const isOpen = Boolean(bot?.session_is_open) && !clockError;
  const minutesToClose =
    bot?.minutes_to_close == null ? null : Number(bot.minutes_to_close);

  let sessionLabel: string;
  if (clockError) {
    sessionLabel = "Session clock error";
  } else if (isOpen && bot?.session_close_at) {
    sessionLabel = `Closes ${formatMaltaTime(bot.session_close_at)} Malta`;
  } else if (!isOpen && bot?.session_open_at) {
    sessionLabel = `Opens ${formatMaltaTime(bot.session_open_at)} Malta`;
  } else {
    sessionLabel = isOpen ? "Market open" : "Market closed";
  }

  return {
    isOpen,
    timeMalta: `${formatMaltaClock(date)} Malta`,
    sessionLabel,
    minutesToClose: Number.isFinite(minutesToClose as number)
      ? (minutesToClose as number)
      : null,
    clockError,
  };
}

/** @deprecated Prefer getMarketStatusFromBot — local calendar is not holiday-aware. */
export function getMarketStatus(date = new Date()): MarketStatus {
  void ET;
  return {
    isOpen: false,
    timeMalta: `${formatMaltaClock(date)} Malta`,
    sessionLabel: "Awaiting engine session clock",
    minutesToClose: null,
    clockError: null,
  };
}
