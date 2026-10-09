"use client";

import { AiExplainToggle } from "@/components/ai-explain-toggle";
import { TradeRecapRichText } from "@/components/trade-recap-rich-text";
import { explainTradeRecap } from "@/lib/trade-recap/actions";
import { recapHeadlineClass } from "@/lib/trade-recap/rich-text";
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
  const tone = entryPrice > 0 ? { netPnl, entryPrice, exitPrice } : undefined;

  return (
    <AiExplainToggle
      action={() => explainTradeRecap(tradeId)}
      labels={{ show: "Recap", hide: "Hide recap", pending: "Recapping…" }}
      panelClassName="max-w-md space-y-2 p-2.5"
      render={({ recap }) => (
        <>
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
        </>
      )}
    />
  );
}
