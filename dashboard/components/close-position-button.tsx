"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (readOnly) {
    return null;
  }

  const disabled = !traderOnline || pending || isPending;
  const label = pending || isPending ? "Closing…" : failed ? "Retry close" : "Close";
  const closingInFlight = isPending;

  function handleConfirm() {
    setActionError(null);
    startTransition(async () => {
      try {
        await requestClosePosition(tradeId);
        setDialogOpen(false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to request close");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        onClick={() => {
          if (disabled) return;
          setActionError(null);
          setDialogOpen(true);
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

      <AlertDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dismissible={!closingInFlight}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Close {symbol} at market?</AlertDialogTitle>
          <AlertDialogDescription>
            The trader will cancel bracket orders (if any) and submit a market sell.
          </AlertDialogDescription>
          {actionError ? (
            <p className="text-sm text-red-400">{actionError}</p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDialogOpen(false)} disabled={closingInFlight}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={closingInFlight}
            className="bg-red-900/80 hover:bg-red-800"
          >
            {closingInFlight ? "Closing…" : "Close position"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialog>
    </div>
  );
}
