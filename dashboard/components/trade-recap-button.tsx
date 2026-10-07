"use client";

import { useState, useTransition } from "react";
import { TradeRecapRichText } from "@/components/trade-recap-rich-text";
import { explainTradeRecap } from "@/lib/trade-recap/actions";
import { recapHeadlineClass } from "@/lib/trade-recap/rich-text";
import type { TradeRecap } from "@/lib/trade-recap/schema";
import { cn } from "@/lib/utils";

type TradeRecapButtonProps = {
  tradeId: string;
  netPnl?: number | null;
  entryPrice?: number;
  exitPrice?: number | null;
};

export function TradeRecapButton({
  tradeId,
  netPnl = null,
  entryPrice = 0,
  exitPrice = null,
}: TradeRecapButtonProps) {
  const tone =
    entryPrice > 0
      ? { netPnl, entryPrice, exitPrice }
      : undefined;
  const [pending, startTransition] = useTransition();
  const [recap, setRecap] = useState<TradeRecap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function onRecap() {
    if (recap) {
      setOpen((current) => !current);
      return;
    }
    setError(null);
    setOpen(true);
    startTransition(async () => {
      const result = await explainTradeRecap(tradeId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecap(result.recap);
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onRecap}
        disabled={pending}
        className="text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
      >
        {pending ? "Recapping…" : open && recap ? "Hide recap" : "Recap"}
      </button>
      {open && error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      {open && recap ? (
        <div className="mt-2 max-w-md space-y-2 rounded-md border border-zinc-800 bg-zinc-950/80 p-2.5 text-xs leading-relaxed text-zinc-300">
          <p className={cn(recapHeadlineClass(netPnl))}>
            <TradeRecapRichText text={recap.headline} tone={tone} />
          </p>
          <p>
            <TradeRecapRichText text={recap.entry_story} tone={tone} />
          </p>
          <p className="text-zinc-400">
            <TradeRecapRichText text={recap.exit_story} tone={tone} />
          </p>
          <p className="border-t border-zinc-800/80 pt-2 text-zinc-300">
            <TradeRecapRichText text={recap.verdict} tone={tone} />
          </p>
          <p className="text-zinc-500">Recap only. Exit settings may have changed since this trade.</p>
        </div>
      ) : null}
    </div>
  );
}
