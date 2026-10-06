"use client";

import { useMemo, useState, useTransition } from "react";
import { explainSymbolTradingDay } from "@/lib/symbol-day-explainer/actions";
import type { SymbolDayExplanation } from "@/lib/symbol-day-explainer/schema";
import type { Prediction } from "@/lib/types/database";

type Props = {
  predictions: Prediction[];
  sessionStartIso: string;
  recordThreshold: number;
  minConfidence: number;
};

export function SymbolDayExplanation({
  predictions,
  sessionStartIso,
  recordThreshold,
  minConfidence,
}: Props) {
  const symbols = useMemo(() => {
    const set = new Set<string>();
    const startMs = new Date(sessionStartIso).getTime();
    for (const row of predictions) {
      if (new Date(row.timestamp).getTime() >= startMs) {
        set.add(row.symbol.toUpperCase());
      }
    }
    return [...set].sort();
  }, [predictions, sessionStartIso]);

  const [symbol, setSymbol] = useState(symbols[0] ?? "");
  const [pending, startTransition] = useTransition();
  const [explanation, setExplanation] = useState<SymbolDayExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onExplain() {
    if (!symbol) return;
    setError(null);
    setExplanation(null);
    startTransition(async () => {
      const result = await explainSymbolTradingDay({
        symbol,
        sessionStartIso,
        recordThreshold,
        minConfidence,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setExplanation(result.explanation);
    });
  }

  if (symbols.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
      <p className="text-sm font-medium text-zinc-200">Symbol day summary</p>
      <p className="mt-1 text-xs text-zinc-500">
        Ask why the bot traded or skipped one watchlist name today.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={symbol}
          onChange={(event) => {
            setSymbol(event.target.value);
            setExplanation(null);
            setError(null);
          }}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
        >
          {symbols.map((sym) => (
            <option key={sym} value={sym}>
              {sym}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onExplain}
          disabled={pending || !symbol}
          className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Summarizing…" : "Summarize"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      {explanation ? (
        <div className="mt-3 space-y-2 text-sm text-zinc-300">
          <p className="font-medium text-zinc-100">{explanation.headline}</p>
          <p className="text-xs leading-relaxed text-zinc-400">{explanation.summary}</p>
          {explanation.main_blockers.length > 0 ? (
            <ul className="list-inside list-disc text-xs text-zinc-500">
              {explanation.main_blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] text-zinc-600">Uses stored predictions for this session.</p>
        </div>
      ) : null}
    </div>
  );
}
