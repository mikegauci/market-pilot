import type { SymbolBar } from "@/lib/types/database";

/** Always fetch/store 5-minute prices (charted as a closing-price line); presets only change the default zoom window. */
export const CHART_BAR_SIZE = "5 mins";

export const CHART_PRESETS = [
  { value: "1h", label: "1H", ms: 1 * 60 * 60 * 1000 },
  { value: "4h", label: "4H", ms: 4 * 60 * 60 * 1000 },
  { value: "1d", label: "1D", ms: 24 * 60 * 60 * 1000 },
  { value: "3d", label: "3D", ms: 3 * 24 * 60 * 60 * 1000 },
  { value: "all", label: "All", ms: null },
] as const;

export type ChartPreset = (typeof CHART_PRESETS)[number]["value"];

export const DEFAULT_CHART_PRESET: ChartPreset = "4h";

export function isChartPreset(value: string): value is ChartPreset {
  return CHART_PRESETS.some((preset) => preset.value === value);
}

export function lookbackMsForPreset(preset: ChartPreset): number | null {
  return CHART_PRESETS.find((item) => item.value === preset)?.ms ?? null;
}

const FIVE_MIN_MS = 5 * 60 * 1000;

/** Bar fetch limit for Supabase (default zoom needs far fewer than 500 rows). */
export function barFetchLimitForPreset(preset: ChartPreset): number {
  if (preset === "all") {
    return 500;
  }
  const lookbackMs = lookbackMsForPreset(preset);
  if (lookbackMs === null) {
    return 500;
  }
  const barsNeeded = Math.ceil(lookbackMs / FIVE_MIN_MS) + 12;
  return Math.min(500, Math.max(barsNeeded, 24));
}

/** Newest-first or mixed rows → ascending by time (full history kept for pan-back). */
export function sortBarsAscending(bars: SymbolBar[]): SymbolBar[] {
  if (bars.length <= 1) return bars;
  return [...bars].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
}
