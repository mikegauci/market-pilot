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
import { requestManualBuy } from "@/lib/actions";
type Props = {
  symbol: string;
  traderOnline: boolean;
  positionOpen: boolean;
  pending?: boolean;
  failed?: boolean;
  errorMessage?: string | null;
};

export function ManualBuyButton({
  symbol,
  traderOnline,
  positionOpen,
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

  const disabled = !traderOnline || positionOpen || pending || isPending;
  const label = pending || isPending ? "Buying…" : failed ? "Retry buy" : "Buy";
  const waitHint =
    pending && errorMessage
      ? errorMessage
      : !traderOnline
        ? "Trader offline — start the trader first"
        : positionOpen
          ? "Already in a position"
          : "Manual buy (risk limits apply)";

  function handleConfirm() {
    setActionError(null);
    startTransition(async () => {
      try {
        await requestManualBuy(symbol);
        setDialogOpen(false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to request buy");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setActionError(null);
          setDialogOpen(true);
        }}
        className="rounded px-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-300 disabled:opacity-40"
        aria-label={
          positionOpen
            ? `${symbol} already has an open position`
            : !traderOnline
              ? "Trader offline — start the trader first"
              : `Buy ${symbol} using risk sizing`
        }
        title={waitHint}
      >
        {label}
      </button>
      {failed && errorMessage ? (
        <span className="sr-only">{errorMessage}</span>
      ) : null}

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen} dismissible={!isPending}>
        <AlertDialogHeader>
          <AlertDialogTitle>Buy {symbol}?</AlertDialogTitle>
          <AlertDialogDescription>
            The trader sizes from your risk settings (max position, open slots, daily loss,
            correlation cap, buying power). Jev and strategy filters are skipped. Live trading
            requires auto-trading to be on.
          </AlertDialogDescription>
          {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending}
            className="bg-emerald-800 hover:bg-emerald-700"
          >
            {isPending ? "Sending…" : "Confirm buy"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialog>
    </>
  );
}
