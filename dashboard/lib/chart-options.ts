import type { SymbolBar } from "@/lib/types/database";

export const CHART_INTERVALS = [
  { value: "5 mins", label: "5m" },
  { value: "1 day", label: "1D" },
] as const;

export type ChartInterval = (typeof CHART_INTERVALS)[number]["value"];

export const CHART_RANGES_BY_INTERVAL: Record<
  ChartInterval,
  readonly { value: string; label: string; ms: number | null }[]
> = {
  "5 mins": [
    { value: "4h", label: "4H", ms: 4 * 60 * 60 * 1000 },
    { value: "1h", label: "1H", ms: 1 * 60 * 60 * 1000 },
    { value: "1d", label: "1D", ms: 24 * 60 * 60 * 1000 },
    { value: "3d", label: "3D", ms: 3 * 24 * 60 * 60 * 1000 },
    { value: "all", label: "All", ms: null },
  ],
  "1 day": [
    { value: "1m", label: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
    { value: "3m", label: "3M", ms: 90 * 24 * 60 * 60 * 1000 },
    { value: "all", label: "All", ms: null },
  ],
};

export function defaultRangeForInterval(interval: ChartInterval): string {
  return CHART_RANGES_BY_INTERVAL[interval][0]?.value ?? "all";
}

/** Newest-first or mixed rows → ascending by time, then optionally truncated by lookback. */
export function filterBarsForChart(
  bars: SymbolBar[],
  interval: ChartInterval,
  rangeValue: string,
): SymbolBar[] {
  if (bars.length === 0) return bars;

  const ascending = [...bars].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );

  const ranges = CHART_RANGES_BY_INTERVAL[interval];
  const selected = ranges.find((r) => r.value === rangeValue);
  if (!selected || selected.ms == null) {
    return ascending;
  }

  const newest = new Date(ascending[ascending.length - 1].ts).getTime();
  const cutoff = newest - selected.ms;
  return ascending.filter((bar) => new Date(bar.ts).getTime() >= cutoff);
}

export function isChartInterval(value: string): value is ChartInterval {
  return CHART_INTERVALS.some((interval) => interval.value === value);
}
