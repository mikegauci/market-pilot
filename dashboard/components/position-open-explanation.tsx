"use client";

import { useState, useTransition } from "react";
import { useReadOnly } from "@/components/read-only-provider";
import { explainOpenPosition } from "@/lib/position-explainer/actions";
import type { PositionExplanation } from "@/lib/position-explainer/schema";
import type { Trade } from "@/lib/types/database";

type Props = {
  symbol: string;
  quantity: number;
  avgCost: number;
  marketPrice: number | null;
  unrealizedPnl: number | null;
  trade: Trade | null;
};

export function PositionOpenExplanation({
  symbol,
  quantity,
  avgCost,
  marketPrice,
  unrealizedPnl,
  trade,
}: Props) {
  const readOnly = useReadOnly();
  const [pending, startTransition] = useTransition();
  const [explanation, setExplanation] = useState<PositionExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function onExplain() {
    if (explanation) {
      setOpen((current) => !current);
      return;
    }
    setError(null);
    setOpen(true);
    startTransition(async () => {
      const result = await explainOpenPosition({
        symbol,
        quantity,
        avgCost,
        marketPrice,
        unrealizedPnl,
        tradeId: trade?.id ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setExplanation(result.explanation);
    });
  }

  if (!trade || readOnly) {
    return null;
  }

  return (
    <div className="mt-2 border-t border-zinc-800/60 pt-2">
      <button
        type="button"
        onClick={onExplain}
        disabled={pending}
        className="text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
      >
        {pending ? "Explaining…" : open && explanation ? "Hide why open" : "Why still open?"}
      </button>
      {open && error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      {open && explanation ? (
        <div className="mt-2 space-y-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-2 text-xs leading-relaxed text-zinc-300">
          <p className="font-medium text-zinc-200">{explanation.headline}</p>
          <p>{explanation.jev_summary}</p>
          <p className="text-zinc-400">{explanation.next_exit}</p>
          <p>{explanation.story}</p>
          <p className="text-zinc-500">Explanation only. Does not change exits.</p>
        </div>
      ) : null}
    </div>
  );
}
