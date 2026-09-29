"use client";

import { useCallback, type ReactNode } from "react";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { fetchLatestPortfolio, fetchPositions } from "@/lib/data-client";
import { useEquityFlash } from "@/lib/hooks/use-equity-flash";
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
  labelExtra,
  value,
  valueClassName,
  valueKey,
}: {
  label: string;
  labelExtra?: ReactNode;
  value: string;
  valueClassName?: string;
  valueKey?: number | string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-800/60 py-3 last:border-0 last:pb-0 first:pt-0">
      <CardTitle className="flex items-baseline gap-1.5 text-zinc-500">
        <span>{label}</span>
        {labelExtra}
      </CardTitle>
      <CardValue key={valueKey} className={cn("mt-0 text-lg sm:text-2xl", valueClassName)}>
        {value}
      </CardValue>
    </div>
  );
}

export function OverviewStats({ portfolio, positions, currency, className }: Props) {
  const botStatus = useLiveBotStatus();
  const tradingMode = botStatus.trading_mode === "live" ? "live" : "paper";

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
  const equity = livePortfolio?.equity ?? null;
  const dailyPnl = livePortfolio?.daily_pnl ?? 0;
  const totalPnl = livePortfolio?.total_pnl ?? 0;
  const { flashKey, flashClassName } = useEquityFlash(equity);

  return (
    <Card className={cn("h-full", className)}>
      <CardTitle>Portfolio</CardTitle>
      <div className="mt-3">
        <StatRow
          label="Equity"
          labelExtra={
            <span
              className={cn(
                "text-[10px] font-medium normal-case tracking-normal",
                tradingMode === "live" ? "text-amber-500/90" : "text-zinc-600",
              )}
            >
              {tradingMode}
            </span>
          }
          value={formatCurrency(equity, displayCurrency)}
          valueKey={flashKey}
          valueClassName={flashClassName}
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
