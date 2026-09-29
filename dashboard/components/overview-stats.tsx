"use client";

import { useCallback } from "react";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { fetchLatestPortfolio, fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { PortfolioSnapshot, Position } from "@/lib/types/database";
import { cn, formatCurrency } from "@/lib/utils";

type Props = {
  portfolio: PortfolioSnapshot | null;
  positions: Position[];
  currency: string;
  className?: string;
};

function StatRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-800/60 py-3 last:border-0 last:pb-0 first:pt-0">
      <CardTitle className="text-zinc-500">{label}</CardTitle>
      <CardValue className={cn("mt-0 text-lg sm:text-2xl", valueClassName)}>{value}</CardValue>
    </div>
  );
}

export function OverviewStats({ portfolio, positions, currency, className }: Props) {
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
  const dailyPnl = livePortfolio?.daily_pnl ?? 0;
  const totalPnl = livePortfolio?.total_pnl ?? 0;

  return (
    <Card className={cn("h-full", className)}>
      <CardTitle>Portfolio</CardTitle>
      <div className="mt-3">
        <StatRow
          label="Equity"
          value={formatCurrency(livePortfolio?.equity, displayCurrency)}
        />
        <StatRow
          label="Daily P&L"
          value={formatCurrency(livePortfolio?.daily_pnl, displayCurrency)}
          valueClassName={dailyPnl >= 0 ? "text-emerald-400" : "text-red-400"}
        />
        <StatRow
          label="Total P&L"
          value={formatCurrency(livePortfolio?.total_pnl, displayCurrency)}
          valueClassName={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
        />
        <StatRow label="Open Positions" value={String(livePositions.length)} />
      </div>
    </Card>
  );
}
