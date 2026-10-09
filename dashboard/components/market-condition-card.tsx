"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { useLiveSettings } from "@/components/shell-live-data-provider";
import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { useLatestPredictions } from "@/lib/latest-predictions-context";
import { getMarketStatus } from "@/lib/market-hours";
import { WatchlistMoveChip } from "@/components/watchlist-move-chip";
import {
  marketConditionDotClass,
  marketConditionFactorClass,
  marketConditionFromLiveData,
  marketConditionToneClass,
  openPositionMoves,
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
): { condition: MarketCondition; watchlist: string[] } {
  const livePredictions = useLatestPredictions(predictions);
  const liveSettings = useLiveSettings(settings);

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

  const condition = useMemo(
    () =>
      marketConditionFromLiveData({
        isMarketOpen,
        predictions: livePredictions,
        watchlist,
        openSymbols,
        benchmarkSymbol: liveSettings?.benchmark_symbol ?? "",
      }),
    [isMarketOpen, livePredictions, watchlist, openSymbols, liveSettings?.benchmark_symbol],
  );

  return { condition, watchlist };
}

export function MarketConditionCard({
  predictions,
  settings,
  openSymbols = [],
  className,
}: Props) {
  const { condition, watchlist } = useLiveMarketCondition(predictions, settings, openSymbols);
  const heldOffWatchlist = useMemo(
    () => openPositionMoves(condition.moves, watchlist),
    [condition.moves, watchlist],
  );

  return (
    <Card className={cn("h-full", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>Watchlist condition</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Summary of 5-minute moves. Each watchlist ticker shows its % on the watchlist card.
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

      {heldOffWatchlist.length > 0 ? (
        <div className="mt-4 border-t border-zinc-800/60 pt-3">
          <p className="text-xs text-zinc-500">Open positions (not on watchlist)</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {heldOffWatchlist.map((move) => (
              <WatchlistMoveChip key={move.symbol} symbol={move.symbol} change5m={move.change5m} />
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
