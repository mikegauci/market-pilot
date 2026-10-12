import type { ChartOverlayLine, SymbolBar } from "@/lib/types/database";

const MARKET_TZ = "America/New_York";
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;
const BAR_MINUTES = 5;

const etFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MARKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function etParts(ts: string): { day: string; minutes: number } | null {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    etFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export type OpeningRangeLevels = { high: number; low: number; day: string };

/**
 * High/low of the newest session's first `rangeMinutes` after the 9:30 ET open, the same
 * window the trader uses. Null until every 5-minute bar in the window exists.
 */
export function openingRangeLevels(
  bars: SymbolBar[],
  rangeMinutes: number,
): OpeningRangeLevels | null {
  let latestDay: string | null = null;
  const rth: { day: string; offset: number; bar: SymbolBar }[] = [];
  for (const bar of bars) {
    const parts = etParts(bar.ts);
    if (!parts || parts.minutes < OPEN_MINUTES || parts.minutes >= CLOSE_MINUTES) continue;
    rth.push({ day: parts.day, offset: parts.minutes - OPEN_MINUTES, bar });
    if (latestDay === null || parts.day > latestDay) latestDay = parts.day;
  }
  if (latestDay === null) return null;

  const needed = Math.max(1, Math.floor(rangeMinutes / BAR_MINUTES));
  const window = new Map<number, SymbolBar>();
  for (const item of rth) {
    if (item.day === latestDay && item.offset < rangeMinutes && item.offset % BAR_MINUTES === 0) {
      window.set(item.offset, item.bar);
    }
  }
  if (window.size < needed) return null;

  const rows = [...window.values()];
  return {
    day: latestDay,
    high: Math.max(...rows.map((bar) => Number(bar.high))),
    low: Math.min(...rows.map((bar) => Number(bar.low))),
  };
}

export function openingRangeOverlays(
  bars: SymbolBar[],
  rangeMinutes: number,
): ChartOverlayLine[] {
  const levels = openingRangeLevels(bars, rangeMinutes);
  if (!levels) return [];
  return [
    { price: levels.high, color: "#38bdf8", label: "Range high", lineStyle: "dashed" },
    { price: levels.low, color: "#fb923c", label: "Range low", lineStyle: "dashed" },
  ];
}
