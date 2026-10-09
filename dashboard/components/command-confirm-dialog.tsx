"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Dialog state for a dashboard command (buy, close, cover): open, run the action, show its error. */
export function useCommandConfirm(action: () => Promise<void>, fallbackError: string) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openDialog() {
    setActionError(null);
    setDialogOpen(true);
  }

  function confirm() {
    setActionError(null);
    startTransition(async () => {
      try {
        await action();
        setDialogOpen(false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : fallbackError);
      }
    });
  }

  return { isPending, dialogOpen, setDialogOpen, actionError, openDialog, confirm };
}

type DialogProps = {
  state: ReturnType<typeof useCommandConfirm>;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  confirmClassName?: string;
};

/** Confirm dialog that can't be dismissed or re-submitted while the command request is in flight. */
export function CommandConfirmDialog({
  state,
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmClassName,
}: DialogProps) {
  const { isPending, dialogOpen, setDialogOpen, actionError, confirm } = state;
  return (
    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen} dismissible={!isPending}>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => setDialogOpen(false)} disabled={isPending}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction onClick={confirm} disabled={isPending} className={confirmClassName}>
          {isPending ? pendingLabel : confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialog>
  );
}
