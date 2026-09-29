"use client";

import { Badge } from "@/components/ui/badge";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import {
  evaluateEntryFilters,
  type FilterCheck,
} from "@/lib/prediction-filters";
import type { MarketSnapshot } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  snapshot: MarketSnapshot | null | undefined;
  symbol: string;
  filterOptions: {
    minVolumeRatio?: number;
    benchmarkSymbol?: string;
  };
  showChart?: boolean;
};

function FilterBadge({ check }: { check: FilterCheck }) {
  if (check.pass === null) {
    return (
      <Badge className="border border-zinc-700 bg-transparent text-zinc-500">
        {check.name}: {check.detail}
      </Badge>
    );
  }
  return (
    <Badge
      className={
        check.pass
          ? "bg-emerald-900/60 text-emerald-300"
          : "bg-red-900/60 text-red-300"
      }
      title={check.detail}
    >
      {check.name}: {check.pass ? "pass" : "fail"}
    </Badge>
  );
}

function IndicatorRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">
        {value}
        {sub && <span className="ml-1 text-zinc-600">{sub}</span>}
      </span>
    </div>
  );
}

export function PredictionIndicators({
  snapshot,
  symbol,
  filterOptions,
  showChart = true,
}: Props) {
  const checks = evaluateEntryFilters(snapshot, filterOptions);
  const failedFilters = checks.filter((c) => c.pass === false);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-zinc-400">Market indicators</p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <IndicatorRow
            label="RSI"
            value={snapshot?.rsi != null ? snapshot.rsi.toFixed(1) : "—"}
          />
          <IndicatorRow
            label="Volume ratio"
            value={snapshot?.volume_ratio != null ? snapshot.volume_ratio.toFixed(2) : "—"}
          />
          <IndicatorRow
            label="EMA-9 / EMA-20"
            value={
              snapshot?.ema_9 != null && snapshot?.ema_20 != null
                ? `${snapshot.ema_9.toFixed(2)} / ${snapshot.ema_20.toFixed(2)}`
                : "—"
            }
          />
          <IndicatorRow
            label="5m / 15m"
            value={
              snapshot?.change_5m != null && snapshot?.change_15m != null
                ? `${snapshot.change_5m.toFixed(2)}% / ${snapshot.change_15m.toFixed(2)}%`
                : "—"
            }
          />
          <IndicatorRow
            label="Benchmark 5m"
            value={
              snapshot?.benchmark_change_5m != null
                ? `${snapshot.benchmark_change_5m.toFixed(2)}%`
                : snapshot?.spy_change_5m != null
                  ? `${snapshot.spy_change_5m.toFixed(2)}%`
                  : "—"
            }
          />
          <IndicatorRow
            label="Spread"
            value={
              snapshot?.spread != null && snapshot?.price
                ? `${((snapshot.spread / snapshot.price) * 100).toFixed(3)}%`
                : "—"
            }
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-zinc-400">Entry filters</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {checks.map((check) => (
            <FilterBadge key={check.name} check={check} />
          ))}
        </div>
        {failedFilters.length > 0 && (
          <p className="mt-2 text-[11px] text-red-400/80">
            {failedFilters.map((c) => `${c.name}: ${c.detail}`).join(" · ")}
          </p>
        )}
      </div>

      {showChart && (
        <div>
          <p className="text-xs font-medium text-zinc-400">Intraday chart</p>
          <div className="mt-2">
            <SymbolChartPanel symbol={symbol} lazy refreshIntervalMs={60_000} />
          </div>
        </div>
      )}
    </div>
  );
}

export function PredictionIndicatorSummary({
  snapshot,
  filterOptions,
}: {
  snapshot: MarketSnapshot | null | undefined;
  filterOptions: Parameters<typeof evaluateEntryFilters>[1];
}) {
  const checks = evaluateEntryFilters(snapshot, filterOptions);
  const failCount = checks.filter((c) => c.pass === false).length;
  const passCount = checks.filter((c) => c.pass === true).length;

  return (
    <span className={cn("text-[10px] tabular-nums", failCount > 0 ? "text-red-400" : "text-zinc-500")}>
      {passCount} pass{failCount > 0 ? ` · ${failCount} fail` : ""}
    </span>
  );
}
