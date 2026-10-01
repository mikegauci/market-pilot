"use client";

import { useLiveBotStatus } from "@/components/bot-status-provider";
import { formatIbkrAccountDisplay } from "@/lib/ibkr-account-display";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Smaller single-line layout for mobile header. */
  compact?: boolean;
};

export function IbkrAccountBadge({ className, compact = false }: Props) {
  const botStatus = useLiveBotStatus();
  const display = formatIbkrAccountDisplay(botStatus.ibkr_account_id);

  if (!display) {
    return (
      <p
        className={cn(
          "text-zinc-600",
          compact ? "text-[10px] leading-tight" : "text-[11px] leading-snug",
          className,
        )}
      >
        {botStatus.ibkr_connected
          ? "IBKR account pending…"
          : "IBKR account — trader offline"}
      </p>
    );
  }

  if (compact) {
    return (
      <p className={cn("truncate text-[10px] leading-tight text-zinc-500", className)}>
        <span className="text-zinc-600">IBKR </span>
        {display.title}
        {display.accountId ? (
          <span className="text-zinc-600"> · {display.accountId}</span>
        ) : null}
      </p>
    );
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-600">
        IBKR account
      </p>
      <p className="text-xs font-medium text-zinc-200">{display.title}</p>
      {display.accountId ? (
        <p className="font-mono text-[10px] text-zinc-500">{display.accountId}</p>
      ) : null}
    </div>
  );
}
