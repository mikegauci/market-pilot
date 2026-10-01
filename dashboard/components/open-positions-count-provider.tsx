"use client";

import { createContext, useCallback, useContext } from "react";
import { fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { Position } from "@/lib/types/database";

const EMPTY_POSITIONS: Position[] = [];

const OpenPositionsContext = createContext<Position[]>(EMPTY_POSITIONS);

export function OpenPositionsCountProvider({ children }: { children: React.ReactNode }) {
  const fetchList = useCallback(() => fetchPositions(), []);
  const positions = useLiveQuery(EMPTY_POSITIONS, fetchList, ["positions"]);

  return (
    <OpenPositionsContext.Provider value={positions}>
      {children}
    </OpenPositionsContext.Provider>
  );
}

export function useOpenPositions(): Position[] {
  return useContext(OpenPositionsContext);
}

export function useOpenPositionsCount(): number {
  return useOpenPositions().length;
}
