"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { generateMorningBrief } from "@/lib/morning-brief/actions";
import type { MorningBrief } from "@/lib/morning-brief/schema";
import { formatDateTime } from "@/lib/utils";

export function MorningBriefCard() {
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateMorningBrief();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBrief(result.brief);
      setGeneratedAt(result.generatedAt);
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Morning brief</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            A note from the current watchlist and headlines from the last 18 hours. It is not
            saved, and it never changes settings or trades.
          </p>
        </div>
        <Button
          type="button"
          disabled={pending}
          className="border border-zinc-600 bg-transparent px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
          onClick={onGenerate}
        >
          {pending ? "Generating…" : brief ? "Regenerate" : "Generate"}
        </Button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      {brief ? (
        <div className="mt-4 space-y-5">
          <h3 className="text-sm font-medium text-zinc-200">{brief.headline}</h3>

          <section className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Names to watch
            </h4>
            {brief.names_to_watch.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No fresh headlines for the watchlist in the last 18 hours.
              </p>
            ) : (
              <ul className="space-y-2 text-sm text-zinc-300">
                {brief.names_to_watch.map((row) => (
                  <li
                    key={`${row.symbol}-${row.note}`}
                    className="rounded-md bg-zinc-900/60 px-3 py-2"
                  >
                    <p className="font-medium text-zinc-200">{row.symbol}</p>
                    <p className="mt-1 text-zinc-400">{row.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {brief.picky_today.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                What the bot will be picky about
              </h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
                {brief.picky_today.map((line, index) => (
                  <li key={`picky-${index}`}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {brief.caveats.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Caveats
              </h4>
              <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-zinc-500">
                {brief.caveats.map((line, index) => (
                  <li key={`caveat-${index}`}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {generatedAt ? (
            <p className="text-xs text-zinc-500">Generated {formatDateTime(generatedAt)}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
