"use client";

import { useState, useTransition } from "react";
import { useReadOnly } from "@/components/read-only-provider";
import { explainSkippedPrediction } from "@/lib/skip-explainer/actions";
import type { SkipCloseness, SkipExplanation } from "@/lib/skip-explainer/schema";

const CLOSENESS_LABEL: Record<SkipCloseness, string> = {
  near_miss: "Near miss",
  hard_block: "Hard block",
  not_a_signal: "Not a buy signal",
};

export function SkipExplanation({ predictionId }: { predictionId: string }) {
  const readOnly = useReadOnly();
  const [pending, startTransition] = useTransition();
  const [explanation, setExplanation] = useState<SkipExplanation | null>(null);
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
      const result = await explainSkippedPrediction(predictionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setExplanation(result.explanation);
    });
  }

  if (readOnly) {
    return null;
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onExplain}
        disabled={pending}
        className="text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
      >
        {pending ? "Explaining…" : open && explanation ? "Hide" : "Why?"}
      </button>
      {open && error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      {open && explanation ? (
        <div className="mt-2 max-w-md space-y-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-2 text-xs leading-relaxed text-zinc-300">
          <p className="font-medium text-zinc-200">{CLOSENESS_LABEL[explanation.closeness]}</p>
          <p>{explanation.what_blocked_it}</p>
          <p className="text-zinc-400">{explanation.summary}</p>
          <p className="text-zinc-500">
            Explanation only. Thresholds are from current settings, not necessarily when this row
            was stored. This does not change trades.
          </p>
        </div>
      ) : null}
    </div>
  );
}
