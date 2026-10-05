"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchSettings } from "@/lib/data-client";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { LIVE_SETTINGS_POLL_MS } from "@/lib/live-data-config";
import { useLatestPredictions } from "@/lib/latest-predictions-context";
import { getMarketStatus } from "@/lib/market-hours";
import {
  marketConditionDotClass,
  marketConditionFactorClass,
  marketConditionFromLiveData,
  marketConditionToneClass,
  type MarketCondition,
} from "@/lib/market-condition";
import type { Prediction, Settings } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  predictions: Prediction[];
  settings: Settings | null;
  openSymbols?: string[];
  className?: string;
};

function useLiveMarketCondition(
  predictions: Prediction[],
  settings: Settings | null,
  openSymbols: string[],
): MarketCondition {
  const livePredictions = useLatestPredictions(predictions);
  const loadSettings = useCallback(() => fetchSettings(), []);

  const liveSettings = useLiveQuery(
    settings,
    loadSettings,
    ["settings"],
    LIVE_SETTINGS_POLL_MS,
    { keepPreviousOnNull: true },
  );

  const [isMarketOpen, setIsMarketOpen] = useState(true);

  useEffect(() => {
    const tick = () => setIsMarketOpen(getMarketStatus().isOpen);
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const watchlist = useMemo(
    () => (liveSettings ? resolveEffectiveWatchlist(liveSettings) : []),
    [liveSettings],
  );

  return useMemo(
    () =>
      marketConditionFromLiveData({
        isMarketOpen,
        predictions: livePredictions,
        watchlist,
        openSymbols,
        benchmarkSymbol: liveSettings?.benchmark_symbol ?? "EEM",
      }),
    [isMarketOpen, livePredictions, watchlist, openSymbols, liveSettings?.benchmark_symbol],
  );
}

export function MarketConditionCard({
  predictions,
  settings,
  openSymbols = [],
  className,
}: Props) {
  const condition = useLiveMarketCondition(predictions, settings, openSymbols);

  return (
    <Card className={cn("h-full", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>Watchlist condition</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Median 5-minute move of your watchlist and open positions.
          </p>
        </div>
        <Link href="/strategy" className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300">
          Strategy
        </Link>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            marketConditionDotClass(condition.level),
          )}
          aria-hidden
        />
        <p className={cn("text-2xl font-semibold", marketConditionToneClass(condition.level))}>
          {condition.label}
        </p>
      </div>

      <p className="mt-2 text-sm leading-snug text-zinc-300">{condition.summary}</p>
      <p className="mt-2 text-xs leading-snug text-zinc-500">{condition.hint}</p>

      <div className="mt-4 space-y-2 border-t border-zinc-800/60 pt-3">
        {condition.factors.map((factor) => (
          <div key={factor.key} className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-xs text-zinc-500">{factor.label}</span>
            <span
              className={cn(
                "text-right text-xs font-medium tabular-nums",
                marketConditionFactorClass(factor.tone),
              )}
            >
              {factor.detail}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
