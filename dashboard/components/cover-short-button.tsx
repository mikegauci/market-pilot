"use client";

import { CommandConfirmDialog, useCommandConfirm } from "@/components/command-confirm-dialog";
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
  const coverQty = Math.abs(Math.trunc(quantity));
  const confirm = useCommandConfirm(
    () => requestCoverShort(symbol, coverQty),
    "Failed to request cover",
  );
  const { isPending } = confirm;

  if (readOnly) {
    return null;
  }

  const disabled = !traderOnline || pending || isPending || coverQty < 1;
  const label = pending || isPending ? "Covering…" : failed ? "Retry cover" : "Cover short";

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

      <CommandConfirmDialog
        state={confirm}
        title={`Cover ${symbol} short?`}
        description={
          <>
            The trader will submit a market buy for {coverQty} share
            {coverQty === 1 ? "" : "s"} to flatten this untracked short at IBKR. This is not a
            bot trade — it only fixes broker exposure.
          </>
        }
        confirmLabel="Cover short"
        pendingLabel="Covering…"
      />
    </div>
  );
}
