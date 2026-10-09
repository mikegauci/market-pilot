"use client";

import { IbkrAccountBadge } from "@/components/ibkr-account-badge";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { useLivePortfolio } from "@/components/shell-live-data-provider";
import { useEquityFlash } from "@/lib/hooks/use-equity-flash";
import { cn, formatCurrency } from "@/lib/utils";

type NavEquityProps = {
  className?: string;
};

export function NavEquity({ className }: NavEquityProps) {
  const botStatus = useLiveBotStatus();
  const tradingMode = botStatus.trading_mode === "live" ? "live" : "paper";

  const portfolio = useLivePortfolio();

  const equity = portfolio?.equity ?? null;
  const currency = portfolio?.currency ?? "USD";
  const { flashKey, flashClassName } = useEquityFlash(equity);

  return (
    <div className={cn("mb-3 space-y-3 px-3 py-2", className)}>
      <IbkrAccountBadge />
      <div>
      <p className="flex items-baseline gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        <span>Equity</span>
        <span
          className={cn(
            "normal-case tracking-normal",
            tradingMode === "live" ? "text-amber-500/90" : "text-zinc-600",
          )}
        >
          {tradingMode}
        </span>
      </p>
      <p
        key={flashKey}
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          equity == null ? "text-zinc-600" : "text-zinc-100",
          flashClassName,
        )}
      >
        {equity == null ? "—" : formatCurrency(equity, currency)}
      </p>
      </div>
    </div>
  );
}
