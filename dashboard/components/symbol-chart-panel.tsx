"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SymbolChart } from "@/components/symbol-chart";
import { fetchSymbolBars } from "@/lib/data-client";
import {
  CHART_BAR_SIZE,
  CHART_PRESETS,
  DEFAULT_CHART_PRESET,
  isChartPreset,
  lookbackMsForPreset,
  sortBarsAscending,
  type ChartPreset,
} from "@/lib/chart-options";
import { CHART_TIMEZONE } from "@/lib/market-hours";
import type { ChartMarker, ChartOverlayLine, SymbolBar } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  symbol: string;
  /** Ignored for UI; charts always use 5-minute bars. Kept for call-site compatibility. */
  barSize?: string;
  overlays?: ChartOverlayLine[];
  markers?: ChartMarker[];
  height?: number;
  /** Defer fetch until the panel enters the viewport. */
  lazy?: boolean;
  /** Poll for fresh bars while visible; 0 disables polling. */
  refreshIntervalMs?: number;
  /** Show lookback / overlay controls (default true). */
  showControls?: boolean;
};

/** Pure helper for chart fetch outcomes — keeps error UI recoverable after polls. */
export function applyChartFetchResult(
  previousError: string | null,
  result: { ok: true; bars: SymbolBar[] } | { ok: false },
): { bars?: SymbolBar[]; error: string | null } {
  if (result.ok) {
    return { bars: result.bars, error: null };
  }
  return {
    error: previousError ?? "Failed to load chart data",
  };
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-zinc-800 bg-zinc-950/60 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded px-2 py-1 text-[11px] font-medium transition",
            value === option.value
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SymbolChartPanel({
  symbol,
  barSize = CHART_BAR_SIZE,
  overlays = [],
  markers = [],
  height = 240,
  lazy = false,
  refreshIntervalMs = 0,
  showControls = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasBarsRef = useRef(false);
  const [isVisible, setIsVisible] = useState(!lazy);
  const [bars, setBars] = useState<SymbolBar[]>([]);
  const [loading, setLoading] = useState(!lazy);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<ChartPreset>(DEFAULT_CHART_PRESET);
  const [showOverlays, setShowOverlays] = useState(true);

  // Charts always use 5m bars; barSize prop is accepted but not switched in the UI.
  const resolvedBarSize = barSize === "1 day" ? CHART_BAR_SIZE : barSize;
  const hasOverlayLines = overlays.length > 0;

  useEffect(() => {
    if (!lazy) return;

    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: "100px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [lazy]);

  useEffect(() => {
    hasBarsRef.current = false;
    const reset = window.setTimeout(() => {
      setBars([]);
      setError(null);
      setLoading(true);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [symbol, resolvedBarSize]);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    async function load(isInitial: boolean) {
      if (isInitial && !hasBarsRef.current) {
        setLoading(true);
      }
      try {
        const data = await fetchSymbolBars(symbol, resolvedBarSize);
        if (cancelled) return;
        const next = applyChartFetchResult(null, { ok: true, bars: data });
        hasBarsRef.current = true;
        setBars(next.bars ?? []);
        setError(next.error);
      } catch {
        if (cancelled) return;
        setError((prev) => applyChartFetchResult(prev, { ok: false }).error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load(true);

    if (refreshIntervalMs <= 0) {
      return () => {
        cancelled = true;
      };
    }

    const pollId = window.setInterval(() => void load(false), refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [symbol, resolvedBarSize, isVisible, refreshIntervalMs]);

  function handlePresetChange(next: string) {
    if (isChartPreset(next)) {
      setPreset(next);
    }
  }

  const displayBars = useMemo(() => sortBarsAscending(bars), [bars]);
  const lookbackMs = lookbackMsForPreset(preset);
  const viewKey = preset;

  const lastBarTs = displayBars.length > 0 ? displayBars[displayBars.length - 1]?.ts : null;
  const asOfLabel = useMemo(() => {
    if (!lastBarTs) return null;
    const date = new Date(lastBarTs);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: CHART_TIMEZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }, [lastBarTs]);

  const activeOverlays = showOverlays ? overlays : [];
  const showPlaceholder = lazy && !isVisible && bars.length === 0 && !error;

  return (
    <div ref={containerRef}>
      {showPlaceholder ? (
        <div
          className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 text-sm text-zinc-600"
          style={{ height }}
        >
          Scroll to load chart
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-400">{symbol}</p>
            {showControls ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <SegmentedControl
                  ariaLabel="Chart lookback"
                  options={CHART_PRESETS}
                  value={preset}
                  onChange={handlePresetChange}
                />
                {hasOverlayLines ? (
                  <button
                    type="button"
                    onClick={() => setShowOverlays((current) => !current)}
                    aria-pressed={showOverlays}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                      showOverlays
                        ? "border-emerald-800/80 bg-emerald-950/40 text-emerald-300"
                        : "border-zinc-800 bg-zinc-950/60 text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    Levels
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {loading && bars.length === 0 ? (
            <div
              className="flex items-center justify-center text-sm text-zinc-500"
              style={{ height }}
            >
              Loading chart…
            </div>
          ) : error && bars.length === 0 ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : displayBars.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              No chart data yet — bars backfill when the trading engine runs.
            </p>
          ) : (
            <>
              <SymbolChart
                bars={displayBars}
                overlays={activeOverlays}
                markers={markers}
                height={height}
                viewKey={viewKey}
                visibleLookbackMs={lookbackMs}
              />
              {asOfLabel ? (
                <p className="mt-1 text-[10px] text-zinc-600">
                  As of {asOfLabel} Malta · drag/swipe for older candles, pinch to zoom
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
