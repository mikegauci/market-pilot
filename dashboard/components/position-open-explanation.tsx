"use client";

import { AiExplainToggle } from "@/components/ai-explain-toggle";
import { explainOpenPosition } from "@/lib/position-explainer/actions";
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
  if (!trade) {
    return null;
  }

  return (
    <AiExplainToggle
      action={() =>
        explainOpenPosition({
          symbol,
          quantity,
          avgCost,
          marketPrice,
          unrealizedPnl,
          tradeId: trade.id,
        })
      }
      labels={{ show: "Why still open?", hide: "Hide why open", pending: "Explaining…" }}
      className="mt-2 border-t border-zinc-800/60 pt-2"
      render={({ explanation }) => (
        <>
          <p className="font-medium text-zinc-200">{explanation.headline}</p>
          <p>{explanation.jev_summary}</p>
          <p className="text-zinc-400">{explanation.next_exit}</p>
          <p>{explanation.story}</p>
          <p className="text-zinc-500">Explanation only. Does not change exits.</p>
        </>
      )}
    />
  );
}
