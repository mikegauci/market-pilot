"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { CHART_TIMEZONE } from "@/lib/market-hours";
import type { ChartMarker, ChartOverlayLine, SymbolBar } from "@/lib/types/database";

type Props = {
  bars: SymbolBar[];
  overlays?: ChartOverlayLine[];
  markers?: ChartMarker[];
  height?: number;
  /** Changing this resets the visible range (e.g. lookback preset). */
  viewKey?: string;
  /** Initial visible window from newest bar; null = show all (fit). */
  visibleLookbackMs?: number | null;
};

function toChartTime(ts: string): UTCTimestamp {
  return Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;
}

function toDate(time: Time): Date | null {
  if (typeof time === "number") {
    return new Date(time * 1000);
  }
  if (typeof time === "string") {
    return new Date(time);
  }
  if (time && typeof time === "object" && "year" in time) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day));
  }
  return null;
}

function formatMalta(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CHART_TIMEZONE,
    ...options,
  }).format(date);
}

function maltaTickMarkFormatter(
  time: Time,
  tickMarkType: TickMarkType,
): string | null {
  const date = toDate(time);
  if (!date) return null;

  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatMalta(date, { year: "numeric" });
    case TickMarkType.Month:
      return formatMalta(date, { month: "short", year: "2-digit" });
    case TickMarkType.DayOfMonth:
      return formatMalta(date, { day: "numeric", month: "short" });
    case TickMarkType.Time:
      return formatMalta(date, { hour: "2-digit", minute: "2-digit", hour12: false });
    case TickMarkType.TimeWithSeconds:
      return formatMalta(date, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    default:
      return formatMalta(date, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

function maltaTimeFormatter(time: Time): string {
  const date = toDate(time);
  if (!date) return "";
  return formatMalta(date, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function overlaysFingerprint(overlays: ChartOverlayLine[]): string {
  return overlays
    .map((overlay) => `${overlay.label}:${overlay.price}:${overlay.color}:${overlay.lineStyle ?? ""}`)
    .join("|");
}

function markersFingerprint(markers: ChartMarker[]): string {
  return markers.map((marker) => `${marker.time}:${marker.label ?? ""}`).join("|");
}

function barsFingerprint(bars: SymbolBar[]): string {
  if (bars.length === 0) return "";
  const first = bars[0];
  const last = bars[bars.length - 1];
  return `${bars.length}:${first?.ts}:${last?.ts}:${last?.close}`;
}

export function SymbolChart({
  bars,
  overlays = [],
  markers = [],
  height = 240,
  viewKey = "",
  visibleLookbackMs = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const fittedViewKeyRef = useRef<string | null>(null);
  const lastBarsFpRef = useRef<string>("");
  const lastOverlaysFpRef = useRef<string>("");
  const lastMarkersFpRef = useRef<string>("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
      },
      timeScale: {
        borderColor: "#3f3f46",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: maltaTickMarkFormatter,
        rightOffset: 4,
        shiftVisibleRangeOnNewBar: false,
      },
      localization: {
        timeFormatter: maltaTimeFormatter,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      crosshair: {
        vertLine: { color: "#52525b" },
        horzLine: { color: "#52525b" },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    fittedViewKeyRef.current = null;
    lastBarsFpRef.current = "";
    lastOverlaysFpRef.current = "";
    lastMarkersFpRef.current = "";

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && chartRef.current) {
        chartRef.current.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      markersApiRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || bars.length === 0) return;

    const barsFp = barsFingerprint(bars);
    const overlaysFp = overlaysFingerprint(overlays);
    const markersFp = markersFingerprint(markers);
    const shouldResetView = fittedViewKeyRef.current !== viewKey;
    const barsChanged = barsFp !== lastBarsFpRef.current;
    const overlaysChanged = overlaysFp !== lastOverlaysFpRef.current;
    const markersChanged = markersFp !== lastMarkersFpRef.current;

    if (!shouldResetView && !barsChanged && !overlaysChanged && !markersChanged) {
      return;
    }

    const previousRange = chart.timeScale().getVisibleLogicalRange();

    if (barsChanged || shouldResetView) {
      series.setData(
        bars.map((bar) => ({
          time: toChartTime(bar.ts),
          open: Number(bar.open),
          high: Number(bar.high),
          low: Number(bar.low),
          close: Number(bar.close),
        })),
      );
      lastBarsFpRef.current = barsFp;
    }

    if (overlaysChanged || shouldResetView) {
      for (const line of priceLinesRef.current) {
        series.removePriceLine(line);
      }
      priceLinesRef.current = overlays.map((overlay) =>
        series.createPriceLine({
          price: overlay.price,
          color: overlay.color,
          lineWidth: 1,
          lineStyle: overlay.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: overlay.label,
        }),
      );
      lastOverlaysFpRef.current = overlaysFp;
    }

    if (markersChanged || shouldResetView) {
      const chartMarkers: SeriesMarker<Time>[] = markers.map((marker) => ({
        time: toChartTime(marker.time),
        position: "aboveBar" as const,
        color: "#a78bfa",
        shape: "circle" as const,
        text: marker.label ?? "Signal",
      }));
      if (markersApiRef.current) {
        markersApiRef.current.setMarkers(chartMarkers);
      } else if (chartMarkers.length > 0) {
        markersApiRef.current = createSeriesMarkers(series, chartMarkers);
      }
      lastMarkersFpRef.current = markersFp;
    }

    if (shouldResetView) {
      applyVisibleLookback(chart, bars, visibleLookbackMs);
      fittedViewKeyRef.current = viewKey;
    } else if (barsChanged && previousRange) {
      chart.timeScale().setVisibleLogicalRange(previousRange);
    }
  }, [bars, overlays, markers, viewKey, visibleLookbackMs]);

  if (bars.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No chart data yet — bars backfill when the trading engine runs.
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full touch-none"
      style={{ height }}
      onWheel={(event) => event.stopPropagation()}
    />
  );
}

function applyVisibleLookback(
  chart: IChartApi,
  bars: SymbolBar[],
  visibleLookbackMs: number | null | undefined,
): void {
  if (visibleLookbackMs == null) {
    chart.timeScale().fitContent();
    return;
  }

  const newestMs = new Date(bars[bars.length - 1]!.ts).getTime();
  const oldestMs = new Date(bars[0]!.ts).getTime();
  const fromMs = Math.max(oldestMs, newestMs - visibleLookbackMs);
  const toMs = newestMs;

  try {
    chart.timeScale().setVisibleRange({
      from: Math.floor(fromMs / 1000) as UTCTimestamp,
      to: Math.floor(toMs / 1000) as UTCTimestamp,
    });
  } catch {
    chart.timeScale().fitContent();
  }
}
