"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { PredictionIndicatorSummary } from "@/components/prediction-indicators";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { useLatestPredictions } from "@/lib/latest-predictions-context";
import { extractBenchmarkChange5m } from "@/lib/market-condition";
import { filterSummaryFromSettings } from "@/lib/prediction-filters";
import { aggregateSkipReasons } from "@/lib/skip-reason-stats";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import type { Prediction, Settings } from "@/lib/types/database";
import { cn, formatDateTime, formatPercent } from "@/lib/utils";

type Props = {
  predictions: Prediction[];
  settings: Settings;
};

export function LiveStrategyGrid({ predictions, settings }: Props) {
  const live = useLatestPredictions(predictions);

  const watchlist = useMemo(() => resolveEffectiveWatchlist(settings), [settings]);
  const filterOptions = filterSummaryFromSettings(settings);
  const benchmark = (settings.benchmark_symbol ?? "").trim();
  const benchmarkEnabled = benchmark.length > 0;

  const bySymbol = useMemo(() => {
    const map = new Map<string, Prediction>();
    for (const p of live) map.set(p.symbol, p);
    return map;
  }, [live]);

  const benchmarkChange = extractBenchmarkChange5m(live, benchmark);
  const benchmarkPrediction = bySymbol.get(benchmark.toUpperCase());

  const recentSkips = useMemo(() => {
    const watchSet = new Set(watchlist.map((s) => s.toUpperCase()));
    return aggregateSkipReasons(
      live.filter((p) => watchSet.has(p.symbol.toUpperCase())),
    ).slice(0, 5);
  }, [live, watchlist]);

  return (
    <div className="space-y-4">
      {benchmarkEnabled ? (
        <Card>
          <CardTitle>Benchmark strip</CardTitle>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-zinc-200">{benchmark}</span>
            {benchmarkChange != null ? (
              <span
                className={cn(
                  "tabular-nums",
                  benchmarkChange >= STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct
                    ? "text-emerald-400"
                    : "text-red-400",
                )}
              >
                5m {benchmarkChange.toFixed(2)}%
              </span>
            ) : (
              <span className="text-zinc-600">No recent data</span>
            )}
            <span className="text-xs text-zinc-600">
              Floor {STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct}% · headwind blocks entries
            </span>
            {benchmarkPrediction ? (
              <span className="text-xs text-zinc-600">
                Updated {formatDateTime(benchmarkPrediction.timestamp)}
              </span>
            ) : benchmarkChange != null ? (
              <span className="text-xs text-zinc-600">From latest watchlist eval</span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {recentSkips.length > 0 && (
        <Card>
          <CardTitle>Active filter blockers (watchlist)</CardTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            {recentSkips.map((bucket) => (
              <Badge key={bucket.key} className="bg-zinc-800 text-zinc-300">
                {bucket.label}: {bucket.count}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div>
        <CardTitle>Live watchlist indicators</CardTitle>
        <p className="mt-1 text-xs text-zinc-600">
          Latest Jev eval per symbol — filter pass/fail uses current thresholds.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {watchlist.map((symbol) => {
            const pred = bySymbol.get(symbol.toUpperCase()) ?? bySymbol.get(symbol);
            const snap = pred?.market_snapshot;

            return (
              <Card key={symbol} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-zinc-100">{symbol}</p>
                  {pred ? (
                    <span className="text-[10px] text-zinc-600">
                      {formatDateTime(pred.timestamp)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-600">No eval yet</span>
                  )}
                </div>
                {pred ? (
                  <>
                    <div className="mt-2 flex gap-3 text-xs tabular-nums">
                      <span className="text-emerald-400">{formatPercent(pred.buy_probability)}</span>
                      <span className="text-zinc-400">{formatPercent(pred.hold_probability)}</span>
                      <span className="text-red-400">{formatPercent(pred.sell_probability)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      <span>RSI {snap?.rsi?.toFixed(1) ?? "—"}</span>
                      <span>Vol {snap?.volume_ratio?.toFixed(2) ?? "—"}</span>
                      <span>5m {snap?.change_5m?.toFixed(2) ?? "—"}%</span>
                      <span>15m {snap?.change_15m?.toFixed(2) ?? "—"}%</span>
                    </div>
                    <div className="mt-2">
                      <PredictionIndicatorSummary
                        snapshot={snap}
                        filterOptions={filterOptions}
                      />
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-zinc-600">Waiting for first eval cycle</p>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
