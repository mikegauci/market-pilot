"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import {
  fetchLatestPredictionsBySymbol,
  fetchMarketNews,
  fetchSettings,
} from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { getMarketStatus } from "@/lib/market-hours";
import {
  marketConditionDotClass,
  marketConditionFactorClass,
  marketConditionFromLiveData,
  marketConditionToneClass,
  type MarketCondition,
} from "@/lib/market-condition";
import type { MarketNewsRow, Prediction, Settings } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  predictions: Prediction[];
  news: MarketNewsRow[];
  settings: Settings | null;
  className?: string;
};

function useLiveMarketCondition(
  predictions: Prediction[],
  news: MarketNewsRow[],
  settings: Settings | null,
): MarketCondition {
  const loadPredictions = useCallback(() => fetchLatestPredictionsBySymbol(), []);
  const loadNews = useCallback(() => fetchMarketNews(80), []);
  const loadSettings = useCallback(() => fetchSettings(), []);

  const livePredictions = useLiveQuery(predictions, loadPredictions, ["predictions"]);
  const liveNews = useLiveQuery(news, loadNews, ["market_news"]);
  const liveSettings = useLiveQuery(settings, loadSettings, ["settings"], undefined, {
    keepPreviousOnNull: true,
  });

  const [isMarketOpen, setIsMarketOpen] = useState(true);

  useEffect(() => {
    const tick = () => setIsMarketOpen(getMarketStatus().isOpen);
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () =>
      marketConditionFromLiveData({
        isMarketOpen,
        predictions: livePredictions,
        news: liveNews,
        benchmarkSymbol: liveSettings?.benchmark_symbol ?? "EEM",
      }),
    [isMarketOpen, livePredictions, liveNews, liveSettings?.benchmark_symbol],
  );
}

export function MarketConditionCard({ predictions, news, settings, className }: Props) {
  const condition = useLiveMarketCondition(predictions, news, settings);

  return (
    <Card className={cn("h-full", className)}>
      <div className="flex items-start justify-between gap-2">
        <CardTitle>Market condition</CardTitle>
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
                "truncate text-right text-xs font-medium tabular-nums",
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
