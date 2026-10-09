"use client";

import { CommandConfirmDialog, useCommandConfirm } from "@/components/command-confirm-dialog";
import { useReadOnly } from "@/components/read-only-provider";
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
  const readOnly = useReadOnly();
  const confirm = useCommandConfirm(
    () => requestClosePosition(tradeId),
    "Failed to request close",
  );
  const { isPending } = confirm;

  if (readOnly) {
    return null;
  }

  const disabled = !traderOnline || pending || isPending;
  const label = pending || isPending ? "Closing…" : failed ? "Retry close" : "Close";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        onClick={() => {
          if (disabled) return;
          confirm.openDialog();
        }}
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

      <CommandConfirmDialog
        state={confirm}
        title={`Close ${symbol} at market?`}
        description="The trader will cancel bracket orders (if any) and submit a market sell."
        confirmLabel="Close position"
        pendingLabel="Closing…"
        confirmClassName="bg-red-900/80 hover:bg-red-800"
      />
    </div>
  );
}
