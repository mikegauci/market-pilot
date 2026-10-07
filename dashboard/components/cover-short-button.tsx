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
import { requestCoverShort } from "@/lib/actions";
import { Button } from "@/components/ui/button";

type Props = {
  symbol: string;
  quantity: number;
  traderOnline: boolean;
  pending?: boolean;
  failed?: boolean;
  errorMessage?: string | null;
};

export function CoverShortButton({
  symbol,
  quantity,
  traderOnline,
  pending = false,
  failed = false,
  errorMessage,
}: Props) {
  const readOnly = useReadOnly();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (readOnly) {
    return null;
  }

  const coverQty = Math.abs(Math.trunc(quantity));
  const disabled = !traderOnline || pending || isPending || coverQty < 1;
  const label = pending || isPending ? "Covering…" : failed ? "Retry cover" : "Cover short";

  function handleConfirm() {
    setActionError(null);
    startTransition(async () => {
      try {
        await requestCoverShort(symbol, coverQty);
        setDialogOpen(false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to request cover");
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
              ? "Cover request sent — waiting for trader"
              : undefined
        }
        className="h-7 px-2.5 text-xs bg-amber-900/80 hover:bg-amber-800 disabled:bg-zinc-800"
      >
        {label}
      </Button>
      {failed && errorMessage ? (
        <span className="text-xs text-red-400">{errorMessage}</span>
      ) : null}
      {actionError ? <span className="text-xs text-red-400">{actionError}</span> : null}

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogHeader>
          <AlertDialogTitle>Cover {symbol} short?</AlertDialogTitle>
          <AlertDialogDescription>
            The trader will submit a market buy for {coverQty} share
            {coverQty === 1 ? "" : "s"} to flatten this untracked short at IBKR. This is not
            a bot trade — it only fixes broker exposure.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Cover short</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialog>
    </div>
  );
}
