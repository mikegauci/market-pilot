"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { generateSettingsAiSummary } from "@/lib/settings-summary/actions";
import type { SettingsAiSummary } from "@/lib/settings-summary/schema";
import { formatDateTime } from "@/lib/utils";

const SECTIONS: {
  key: keyof Pick<
    SettingsAiSummary,
    "jev_and_signals" | "risk_and_limits" | "exits_and_filters" | "watchlist"
  >;
  title: string;
  anchor: string;
}[] = [
  { key: "jev_and_signals", title: "Jev & signals", anchor: "#jev-signals" },
  { key: "risk_and_limits", title: "Risk & limits", anchor: "#risk-limits" },
  { key: "exits_and_filters", title: "Exits & filters", anchor: "#exits-filters" },
  { key: "watchlist", title: "Watchlist", anchor: "#watchlist" },
];

function SummarySection({
  title,
  anchor,
  bullets,
}: {
  title: string;
  anchor: string;
  bullets: string[];
}) {
  if (bullets.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        <a href={anchor} className="hover:text-emerald-400/90">
          {title}
        </a>
      </h4>
      <ul className="space-y-1.5 text-sm leading-relaxed text-zinc-300">
        {bullets.map((line, index) => (
          <li
            key={`${title}-${index}`}
            className="rounded-md border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 pl-3"
          >
            <span className="mr-2 text-emerald-500/70">•</span>
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsAiSummaryCard() {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<SettingsAiSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateSettingsAiSummary();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      setGeneratedAt(result.generatedAt);
    });
  }

  return (
    <Card className="border-zinc-800/80 bg-zinc-900/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Settings summary</CardTitle>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">
            OpenAI reads your saved settings and writes a short overview. It does not change
            anything on this page.
          </p>
        </div>
        <Button
          type="button"
          disabled={pending}
          className="border border-zinc-600 bg-transparent px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
          onClick={onGenerate}
        >
          {pending ? "Summarizing…" : summary ? "Refresh summary" : "Summarize settings"}
        </Button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      {summary ? (
        <div className="mt-5 space-y-5">
          <p className="border-l-2 border-emerald-500/50 pl-3 text-sm font-medium leading-snug text-zinc-100">
            {summary.headline}
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            {SECTIONS.map(({ key, title, anchor }) => (
              <SummarySection
                key={key}
                title={title}
                anchor={anchor}
                bullets={summary[key]}
              />
            ))}
          </div>

          {summary.trader_only_note ? (
            <p className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs leading-relaxed text-zinc-500">
              <span className="font-medium text-zinc-400">Trader .env: </span>
              {summary.trader_only_note}
            </p>
          ) : null}

          {generatedAt ? (
            <p className="text-[11px] text-zinc-600">
              Generated {formatDateTime(generatedAt)} · reflects saved settings at that time
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-600">
          Click summarize to get a structured readout of confidence gates, risk caps, exits, and
          watchlist behavior.
        </p>
      )}
    </Card>
  );
}
