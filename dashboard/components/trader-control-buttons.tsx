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
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { useReadOnly } from "@/components/read-only-provider";
import {
  cancelTraderShutdown,
  requestTraderShutdown,
  setAutoTradingEnabled,
} from "@/lib/actions";
import { getDisplayStatus, isStopRequestStale } from "@/lib/trader-status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNowTick } from "@/lib/hooks/use-now-tick";

export function TraderControlButtons({ className }: { className?: string }) {
  const readOnly = useReadOnly();
  const status = useLiveBotStatus();
  // bot_status stops changing when the trader goes down, so tick to let the heartbeat age out.
  const now = useNowTick();
  const display = getDisplayStatus(status, now);
  const [isPending, startTransition] = useTransition();
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (readOnly) {
    return null;
  }

  const traderOnline = display.traderOnline;
  const stopRequested = Boolean(status.shutdown_requested);
  const stopStale = isStopRequestStale(status, now);
  const stopping = stopRequested && traderOnline;
  const autoTradingOn = status.enabled;

  function toggleAutoTrading() {
    setActionError(null);
    startTransition(async () => {
      try {
        await setAutoTradingEnabled(!autoTradingOn);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not update auto-trading");
      }
    });
  }

  function confirmStopEngine() {
    setActionError(null);
    startTransition(async () => {
      try {
        await requestTraderShutdown();
        setStopDialogOpen(false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not stop engine");
      }
    });
  }

  function handleCancelStop() {
    setActionError(null);
    startTransition(async () => {
      try {
        await cancelTraderShutdown();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not cancel stop");
      }
    });
  }

  const pauseLabel = isPending
    ? autoTradingOn
      ? "Pausing…"
      : "Resuming…"
    : autoTradingOn
      ? "Pause new trades"
      : "Resume new trades";

  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-950/60 p-3", className)}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Engine controls</p>
      <p className="mt-1 text-[11px] leading-snug text-zinc-500">
        Pause skips new entries; open positions still manage exits. Stop ends the Python trader on this
        machine (within ~5s).
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <Button
          type="button"
          onClick={toggleAutoTrading}
          disabled={isPending}
          className="h-9 w-full bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
        >
          {pauseLabel}
        </Button>

        {stopStale ? (
          <>
            <p className="text-[11px] leading-snug text-amber-200/90">
              Stop did not finish — the engine is offline but the stop request is still set. Cancel
              it, then start the trader again.
            </p>
            <Button
              type="button"
              onClick={handleCancelStop}
              disabled={isPending}
              className="h-9 w-full bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            >
              {isPending ? "Canceling…" : "Cancel stop request"}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={() => {
              if (!traderOnline || stopping) return;
              setActionError(null);
              setStopDialogOpen(true);
            }}
            disabled={!traderOnline || stopping || isPending}
            title={
              !traderOnline
                ? "Start python main.py in trader/ first"
                : stopping
                  ? "Stop already requested"
                  : undefined
            }
            className="h-9 w-full bg-red-950/80 text-red-100 hover:bg-red-900 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {stopping ? "Stopping engine…" : "Stop engine"}
          </Button>
        )}
      </div>

      {actionError ? (
        <p className="mt-2 text-[11px] leading-snug text-red-400">{actionError}</p>
      ) : null}

      <AlertDialog
        open={stopDialogOpen}
        onOpenChange={setStopDialogOpen}
        dismissible={!isPending}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Stop the trading engine?</AlertDialogTitle>
          <AlertDialogDescription>
            The bot will disconnect from IBKR and exit. It will not open new trades until you start{" "}
            <span className="text-zinc-300">python main.py</span> again in the{" "}
            <span className="text-zinc-300">trader/</span> folder. Open positions keep their broker
            orders; exits resume when the engine is back online.
          </AlertDialogDescription>
          {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setStopDialogOpen(false)} disabled={isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmStopEngine}
            disabled={isPending}
            className="bg-red-900/80 hover:bg-red-800"
          >
            {isPending ? "Stopping…" : "Stop engine"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialog>
    </div>
  );
}
