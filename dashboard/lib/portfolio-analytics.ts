import type { PortfolioSnapshot } from "@/lib/types/database";
import {
  tradingEquityFromSnapshot,
  type TradingMode,
} from "@/lib/trading-equity";

export type PortfolioRange = "1d" | "1w" | "1m" | "all";

export type DailyPnlPoint = {
  date: string;
  dailyPnl: number;
};

export type DailyEquityPoint = {
  date: string;
  equity: number;
  /** Equity vs previous day in series; null for the first day. */
  changeFromPriorDay: number | null;
};

export function portfolioRangeStartMs(range: PortfolioRange, now = Date.now()): number | null {
  switch (range) {
    case "1d":
      return now - 24 * 60 * 60 * 1000;
    case "1w":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "1m":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

export function filterPortfolioByRange(
  history: PortfolioSnapshot[],
  range: PortfolioRange,
): PortfolioSnapshot[] {
  const start = portfolioRangeStartMs(range);
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  if (start == null) return sorted;
  return sorted.filter((row) => new Date(row.timestamp).getTime() >= start);
}

function lastSnapshotValuePerDay(
  history: PortfolioSnapshot[],
  pick: (row: PortfolioSnapshot) => number,
): Map<string, number> {
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const byDay = new Map<string, number>();
  for (const row of sorted) {
    byDay.set(row.timestamp.slice(0, 10), pick(row));
  }
  return byDay;
}

export function buildDailyPnlSeries(history: PortfolioSnapshot[]): DailyPnlPoint[] {
  const byDay = lastSnapshotValuePerDay(history, (row) => row.daily_pnl ?? 0);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dailyPnl]) => ({ date, dailyPnl }));
}

/** Y-axis domain that zooms to min/max equity so small day-to-day moves are visible. */
export function equityChartDomain(equities: number[]): [number, number] {
  if (equities.length === 0) return [0, 1];
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const span = max - min;
  const center = (min + max) / 2;
  const minSpan = Math.max(Math.abs(center) * 0.002, 50);
  if (span < minSpan) {
    const half = minSpan / 2;
    const pad = half * 0.12;
    return [center - half - pad, center + half + pad];
  }
  const pad = span * 0.12;
  return [min - pad, max + pad];
}

export function buildDailyEquitySeries(
  history: PortfolioSnapshot[],
  tradingMode: TradingMode = "paper",
): DailyEquityPoint[] {
  const byDay = lastSnapshotValuePerDay(history, (row) =>
    tradingEquityFromSnapshot(row, tradingMode),
  );
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  let priorEquity: number | null = null;
  return days.map(([date, equity]) => {
    const changeFromPriorDay =
      priorEquity != null ? equity - priorEquity : null;
    priorEquity = equity;
    return { date, equity, changeFromPriorDay };
  });
}
