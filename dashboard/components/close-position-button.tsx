"use client";

import { useTransition } from "react";
import { requestClosePosition } from "@/lib/actions";
import { Button } from "@/components/ui/button";

type Props = {
  tradeId: string;
  symbol: string;
  traderOnline: boolean;
  pending?: boolean;
  failed?: boolean;
  errorMessage?: string | null;
  size?: "sm" | "md";
};

export function ClosePositionButton({
  tradeId,
  symbol,
  traderOnline,
  pending = false,
  failed = false,
  errorMessage,
  size = "sm",
}: Props) {
  const [isPending, startTransition] = useTransition();

  const disabled = !traderOnline || pending || isPending;
  const label = pending || isPending ? "Closing…" : failed ? "Retry close" : "Close";

  function handleClick() {
    if (disabled) return;
    const confirmed = window.confirm(
      `Close ${symbol} at market?\n\nThe trader will cancel bracket orders (if any) and submit a market sell.`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      try {
        await requestClosePosition(tradeId);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Failed to request close");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={
          !traderOnline
            ? "Trader offline — start the trader process first"
            : pending
              ? "Close request sent — waiting for trader"
              : undefined
        }
        className={
          size === "sm"
            ? "h-7 px-2.5 text-xs bg-red-900/80 hover:bg-red-800 disabled:bg-zinc-800"
            : undefined
        }
      >
        {label}
      </Button>
      {failed && errorMessage ? (
        <span className="max-w-[10rem] text-[10px] leading-snug text-red-400" title={errorMessage}>
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
