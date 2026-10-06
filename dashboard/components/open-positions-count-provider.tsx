"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { Position } from "@/lib/types/database";

const EMPTY_POSITIONS: Position[] = [];

export type OpenPositionsLiveState = {
  positions: Position[];
  /** True after the first successful positions poll (empty list is valid). */
  hasLiveSnapshot: boolean;
};

const defaultLiveState: OpenPositionsLiveState = {
  positions: EMPTY_POSITIONS,
  hasLiveSnapshot: false,
};

const OpenPositionsContext = createContext<OpenPositionsLiveState>(defaultLiveState);

export function OpenPositionsCountProvider({ children }: { children: ReactNode }) {
  const [hasLiveSnapshot, setHasLiveSnapshot] = useState(false);

  const fetchList = useCallback(async () => {
    const next = await fetchPositions();
    setHasLiveSnapshot(true);
    return next;
  }, []);

  const positions = useLiveQuery(EMPTY_POSITIONS, fetchList, ["positions"]);

  const value = useMemo(
    () => ({ positions, hasLiveSnapshot }),
    [positions, hasLiveSnapshot],
  );

  return (
    <OpenPositionsContext.Provider value={value}>
      {children}
    </OpenPositionsContext.Provider>
  );
}

export function useOpenPositionsLive(): OpenPositionsLiveState {
  return useContext(OpenPositionsContext);
}

export function useOpenPositions(): Position[] {
  return useOpenPositionsLive().positions;
}

export function useOpenPositionsCount(): number {
  return useOpenPositions().length;
}

/** SSR rows until the first live poll; then trust polled data (including empty). */
export function positionsWithSsrFallback(
  serverPositions: Position[],
  live: OpenPositionsLiveState,
): Position[] {
  return live.hasLiveSnapshot ? live.positions : serverPositions;
}

export function usePositionsWithSsrFallback(serverPositions: Position[]): Position[] {
  const live = useOpenPositionsLive();
  return positionsWithSsrFallback(serverPositions, live);
}
