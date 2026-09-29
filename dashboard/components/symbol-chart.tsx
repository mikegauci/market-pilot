"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { ChartMarker, ChartOverlayLine, SymbolBar } from "@/lib/types/database";

type Props = {
  bars: SymbolBar[];
  overlays?: ChartOverlayLine[];
  markers?: ChartMarker[];
  height?: number;
};

function toChartTime(ts: string): UTCTimestamp {
  return Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp;
}

export function SymbolChart({ bars, overlays = [], markers = [], height = 240 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

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

    series.setData(
      bars.map((bar) => ({
        time: toChartTime(bar.ts),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
      })),
    );

    for (const overlay of overlays) {
      series.createPriceLine({
        price: overlay.price,
        color: overlay.color,
        lineWidth: 1,
        lineStyle: overlay.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: overlay.label,
      });
    }

    if (markers.length > 0) {
      const chartMarkers: SeriesMarker<Time>[] = markers.map((marker) => ({
        time: toChartTime(marker.time),
        position: "aboveBar" as const,
        color: "#a78bfa",
        shape: "circle" as const,
        text: marker.label ?? "Signal",
      }));
      createSeriesMarkers(series, chartMarkers);
    }

    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

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
    };
  }, [bars, overlays, markers, height]);

  if (bars.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No chart data yet — bars backfill when the trading engine runs.
      </p>
    );
  }

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
