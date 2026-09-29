"use client";

import { createContext, useCallback, useContext } from "react";
import { fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { Position } from "@/lib/types/database";

const EMPTY_POSITIONS: Position[] = [];

const OpenPositionsCountContext = createContext(0);

export function OpenPositionsCountProvider({ children }: { children: React.ReactNode }) {
  const fetchList = useCallback(() => fetchPositions(), []);
  const positions = useLiveQuery(EMPTY_POSITIONS, fetchList, ["positions"]);

  return (
    <OpenPositionsCountContext.Provider value={positions.length}>
      {children}
    </OpenPositionsCountContext.Provider>
  );
}

export function useOpenPositionsCount(): number {
  return useContext(OpenPositionsCountContext);
}
