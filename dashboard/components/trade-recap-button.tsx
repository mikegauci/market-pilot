"use client";

import { useState, useTransition } from "react";
import { explainTradeRecap } from "@/lib/trade-recap/actions";
import type { TradeRecap } from "@/lib/trade-recap/schema";

export function TradeRecapButton({ tradeId }: { tradeId: string }) {
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
        <div className="mt-2 max-w-md space-y-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-2 text-xs leading-relaxed text-zinc-300">
          <p className="font-medium text-zinc-200">{recap.headline}</p>
          <p>{recap.entry_story}</p>
          <p className="text-zinc-400">{recap.exit_story}</p>
          <p>{recap.verdict}</p>
          <p className="text-zinc-500">Recap only. Exit settings may have changed since this trade.</p>
        </div>
      ) : null}
    </div>
  );
}
