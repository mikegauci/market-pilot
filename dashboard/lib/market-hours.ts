const ET = "America/New_York";
const MALTA = "Europe/Malta";
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MARKET_CLOSE_MINUTES = 16 * 60;

export type MarketStatus = {
  isOpen: boolean;
  timeMalta: string;
  sessionLabel: string;
};

function getEtParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );

  const weekday = parts.weekday ?? "Mon";
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  return {
    isWeekday: weekday !== "Sat" && weekday !== "Sun",
    calendarDate: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: hour * 60 + minute,
    hour,
    minute,
    second,
  };
}

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

function formatMaltaTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MALTA,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function atEtTime(calendarDate: string, hour: number, minute: number): Date {
  const [year, month, day] = calendarDate.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day, 12, 0, 0);

  for (let offsetMin = -24 * 60; offsetMin <= 24 * 60; offsetMin++) {
    const candidate = new Date(base + offsetMin * 60_000);
    const parts = getEtParts(candidate);

    if (
      parts.calendarDate === calendarDate &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === 0
    ) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve ${calendarDate} ${hour}:${minute} ET`);
}

function getNextMarketOpen(from: Date): Date {
  const start = getEtParts(from);
  let probe = atEtTime(start.calendarDate, 12, 0);

  for (let day = 0; day < 8; day++) {
    const calendarDate = getEtParts(probe).calendarDate;
    const weekday = getEtParts(probe);

    if (weekday.isWeekday) {
      const open = atEtTime(calendarDate, 9, 30);
      if (open > from) {
        return open;
      }
    }

    probe = new Date(probe.getTime() + 24 * 60 * 60 * 1000);
  }

  throw new Error("Could not find next market open");
}

function getNextMarketClose(from: Date): Date {
  const parts = getEtParts(from);

  if (parts.isWeekday && parts.minutesSinceMidnight < MARKET_CLOSE_MINUTES) {
    return atEtTime(parts.calendarDate, 16, 0);
  }

  return getNextMarketOpen(from);
}

function sessionLabel(isOpen: boolean, nextEvent: Date) {
  const maltaTime = formatMaltaTime(nextEvent);
  return isOpen ? `Closes ${maltaTime} Malta` : `Opens ${maltaTime} Malta`;
}

export function getMarketStatus(date = new Date()): MarketStatus {
  const { isWeekday, minutesSinceMidnight } = getEtParts(date);
  const isOpen =
    isWeekday &&
    minutesSinceMidnight >= MARKET_OPEN_MINUTES &&
    minutesSinceMidnight < MARKET_CLOSE_MINUTES;

  const nextEvent = isOpen ? getNextMarketClose(date) : getNextMarketOpen(date);

  return {
    isOpen,
    timeMalta: `${formatMaltaClock(date)} Malta`,
    sessionLabel: sessionLabel(isOpen, nextEvent),
  };
}
