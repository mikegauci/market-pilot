"use client";

import { useCallback } from "react";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { fetchLatestPortfolio, fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { PortfolioSnapshot, Position } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type Props = {
  portfolio: PortfolioSnapshot | null;
  positions: Position[];
  currency: string;
};

export function OverviewStats({ portfolio, positions, currency }: Props) {
  const fetchPortfolio = useCallback(() => fetchLatestPortfolio(), []);
  const fetchPositionsList = useCallback(() => fetchPositions(), []);

  const livePortfolio = useLiveQuery(
    portfolio,
    fetchPortfolio,
    ["portfolio_history"],
    undefined,
    { keepPreviousOnNull: true },
  );
  const livePositions = useLiveQuery(positions, fetchPositionsList, ["positions"]);

  const displayCurrency = livePortfolio?.currency ?? currency;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardTitle>Equity</CardTitle>
        <CardValue>{formatCurrency(livePortfolio?.equity, displayCurrency)}</CardValue>
      </Card>
      <Card>
        <CardTitle>Daily P&L</CardTitle>
        <CardValue
          className={
            (livePortfolio?.daily_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
          }
        >
          {formatCurrency(livePortfolio?.daily_pnl, displayCurrency)}
        </CardValue>
      </Card>
      <Card>
        <CardTitle>Total P&L</CardTitle>
        <CardValue
          className={
            (livePortfolio?.total_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
          }
        >
          {formatCurrency(livePortfolio?.total_pnl, displayCurrency)}
        </CardValue>
      </Card>
      <Card>
        <CardTitle>Open Positions</CardTitle>
        <CardValue>{livePositions.length}</CardValue>
      </Card>
    </div>
  );
}
