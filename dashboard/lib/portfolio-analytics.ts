import type { PortfolioSnapshot } from "@/lib/types/database";

export type PortfolioRange = "1d" | "1w" | "1m" | "all";

export type EquityPoint = {
  timestamp: string;
  equity: number;
  dailyPnl: number;
  drawdownPct: number;
};

export type DailyPnlPoint = {
  date: string;
  dailyPnl: number;
};

function rangeStart(range: PortfolioRange, now = Date.now()): number | null {
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
  const start = rangeStart(range);
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  if (start == null) return sorted;
  return sorted.filter((row) => new Date(row.timestamp).getTime() >= start);
}

export function buildEquitySeries(history: PortfolioSnapshot[]): EquityPoint[] {
  let peak = 0;
  return history.map((row) => {
    const equity = row.equity ?? 0;
    if (equity > peak) peak = equity;
    const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    return {
      timestamp: row.timestamp,
      equity,
      dailyPnl: row.daily_pnl ?? 0,
      drawdownPct,
    };
  });
}

export function buildDailyPnlSeries(history: PortfolioSnapshot[]): DailyPnlPoint[] {
  const byDay = new Map<string, number>();
  for (const row of history) {
    const day = row.timestamp.slice(0, 10);
    byDay.set(day, row.daily_pnl ?? 0);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dailyPnl]) => ({ date, dailyPnl }));
}

export function maxDrawdownPct(history: PortfolioSnapshot[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const row of history) {
    const equity = row.equity ?? 0;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = ((equity - peak) / peak) * 100;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd;
}
