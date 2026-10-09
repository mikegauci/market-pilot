"use client";

import { AiExplainToggle } from "@/components/ai-explain-toggle";
import { explainSkippedPrediction } from "@/lib/skip-explainer/actions";
import type { SkipCloseness } from "@/lib/skip-explainer/schema";

const CLOSENESS_LABEL: Record<SkipCloseness, string> = {
  near_miss: "Near miss",
  hard_block: "Blocked before trade",
  not_a_signal: "Not a buy signal",
};

export function SkipExplanation({ predictionId }: { predictionId: string }) {
  return (
    <AiExplainToggle
      action={() => explainSkippedPrediction(predictionId)}
      labels={{ show: "Why?", hide: "Hide", pending: "Explaining…" }}
      panelClassName="max-w-md"
      render={({ explanation }) => (
        <>
          <p className="font-medium text-zinc-200">{CLOSENESS_LABEL[explanation.closeness]}</p>
          <p>{explanation.what_blocked_it}</p>
          <p className="text-zinc-400">{explanation.summary}</p>
          <p className="text-zinc-500">
            Explanation only. Thresholds are from current settings, not necessarily when this row
            was stored. This does not change trades.
          </p>
        </>
      )}
    />
  );
}
