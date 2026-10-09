"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { fetchLatestPredictionsBySymbol } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { LIVE_PREDICTIONS_POLL_MS } from "@/lib/live-data-config";
import type { Prediction } from "@/lib/types/database";

type LatestPredictionsContextValue = {
  predictions: Prediction[];
};

const LatestPredictionsContext = createContext<LatestPredictionsContextValue | null>(
  null,
);

type ProviderProps = {
  initial: Prediction[];
  children: ReactNode;
};

/** One poll for latest-per-symbol predictions (Overview + Strategy share this). */
export function LatestPredictionsProvider({ initial, children }: ProviderProps) {
  const load = useCallback(() => fetchLatestPredictionsBySymbol(), []);
  const predictions = useLiveQuery(initial, load, ["predictions"], LIVE_PREDICTIONS_POLL_MS, {
    keepPreviousOnEmpty: true,
    skipInitialFetch: true,
  });

  const value = useMemo(() => ({ predictions }), [predictions]);

  return (
    <LatestPredictionsContext.Provider value={value}>
      {children}
    </LatestPredictionsContext.Provider>
  );
}

export function useLatestPredictions(fallback: Prediction[] = []): Prediction[] {
  const ctx = useContext(LatestPredictionsContext);
  return ctx?.predictions ?? fallback;
}
