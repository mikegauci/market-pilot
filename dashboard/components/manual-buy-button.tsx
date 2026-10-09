"use client";

import { CommandConfirmDialog, useCommandConfirm } from "@/components/command-confirm-dialog";
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
  const confirm = useCommandConfirm(
    () => requestManualBuy(symbol),
    "Failed to request buy",
  );
  const { isPending } = confirm;

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

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          confirm.openDialog();
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

      <CommandConfirmDialog
        state={confirm}
        title={`Buy ${symbol}?`}
        description="The trader sizes from your risk settings (max position, open slots, daily loss, correlation cap, buying power). Jev and strategy filters are skipped. Live trading requires auto-trading to be on."
        confirmLabel="Confirm buy"
        pendingLabel="Sending…"
        confirmClassName="bg-emerald-800 hover:bg-emerald-700"
      />
    </>
  );
}
