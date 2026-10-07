"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { marketConditionToneClass } from "@/lib/market-condition";
import { useReadOnly } from "@/components/read-only-provider";
import { generateSessionBrief } from "@/lib/session-brief/actions";
import { defaultSelectedSessionDate, type SessionBriefHistoryEntry } from "@/lib/session-brief/history";
import {
  formatSharePercent,
  sessionConditionCoverageNote,
  sharesFromMinutes,
  type SessionConditionMinutes,
} from "@/lib/session-brief/market-condition-mix";
import { sessionBriefSettingLabel } from "@/lib/session-brief/setting-diff";
import type { SessionBriefContent } from "@/lib/types/database";
import { cn, formatDateTime } from "@/lib/utils";

type Props = {
  initialHistory: SessionBriefHistoryEntry[];
  initialConditionMix?: SessionConditionMinutes[];
  initialLoadError?: string | null;
  initialMixError?: string | null;
};

function ConditionMixLine({ row }: { row: SessionConditionMinutes }) {
  const shares = sharesFromMinutes(row);
  if (shares.length === 0) {
    return <span className="mt-0.5 block text-[10px] text-zinc-500">No watchlist readings</span>;
  }
  return (
    <span className="mt-0.5 block">
      {shares.map((share, index) => (
        <span key={share.level}>
          {index > 0 ? <span className="text-zinc-600">, </span> : null}
          <span className={marketConditionToneClass(share.level)}>
            {formatSharePercent(share.percent)} {share.label}
          </span>
        </span>
      ))}
    </span>
  );
}

function directionLabel(direction: "raise" | "lower" | "keep"): string {
  if (direction === "raise") return "Consider raising";
  if (direction === "lower") return "Consider lowering";
  return "Keep as is";
}

function formatSessionDayLabel(sessionDate: string): string {
  const d = new Date(`${sessionDate}T12:00:00`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function BriefBody({
  brief,
  hideHeadline = false,
}: {
  brief: SessionBriefContent;
  hideHeadline?: boolean;
}) {
  return (
    <div className="space-y-5">
      {!hideHeadline ? (
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{brief.headline}</h3>
        </div>
      ) : null}

      {brief.what_happened.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            What happened
          </h4>
          <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed text-zinc-300">
            {brief.what_happened.map((line, index) => (
              <li key={`what-${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.entry_blockers.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Entry blockers
          </h4>
          <ul className="space-y-2 text-sm text-zinc-300">
            {brief.entry_blockers.map((row, index) => (
              <li
                key={`blocker-${index}-${row.reason}`}
                className="rounded-md bg-zinc-900/60 px-3 py-2"
              >
                <p className="font-medium text-zinc-200">
                  {row.reason}{" "}
                  <span className="font-normal text-zinc-500">({row.count})</span>
                </p>
                <p className="mt-1 text-zinc-400">{row.takeaway}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.exits.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Exits</h4>
          <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
            {brief.exits.map((line, index) => (
              <li key={`exit-${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.suggestions.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Settings to review
          </h4>
          <ul className="space-y-2 text-sm text-zinc-300">
            {brief.suggestions.map((row) => (
              <li
                key={`${row.setting}-${row.direction}`}
                className="rounded-md border border-zinc-800 px-3 py-2"
              >
                <p className="font-medium text-zinc-200">
                  {sessionBriefSettingLabel(row.setting)}{" "}
                  <span className="text-emerald-400/90">({directionLabel(row.direction)})</span>
                </p>
                <p className="mt-1 text-zinc-400">{row.why}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            Known settings can be reviewed on Settings. Applying a step still needs Save.
          </p>
        </section>
      ) : null}

      {brief.caveats.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Caveats</h4>
          <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-zinc-500">
            {brief.caveats.map((line, index) => (
              <li key={`caveat-${index}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function SessionBriefCard({
  initialHistory,
  initialConditionMix = [],
  initialLoadError = null,
  initialMixError = null,
}: Props) {
  const readOnly = useReadOnly();
  const [briefOpen, setBriefOpen] = useState(true);
  const [history, setHistory] = useState(initialHistory);
  const [loadError] = useState(initialLoadError);
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    defaultSelectedSessionDate(initialHistory),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chronologicalDays = useMemo(
    () => [...history].sort((a, b) => a.session_date.localeCompare(b.session_date)),
    [history],
  );

  const selectedEntry = useMemo(
    () => history.find((row) => row.session_date === selectedDate) ?? null,
    [history, selectedDate],
  );

  const selectedBrief = selectedEntry?.brief ?? null;
  const mixByDate = useMemo(() => {
    const map = new Map<string, SessionConditionMinutes>();
    for (const row of initialConditionMix) map.set(row.session_date, row);
    return map;
  }, [initialConditionMix]);
  const selectedMix = selectedDate ? mixByDate.get(selectedDate) ?? null : null;

  const handleGenerate = () => {
    if (!selectedDate) return;
    setError(null);
    startTransition(async () => {
      const result = await generateSessionBrief(selectedDate);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setHistory((current) =>
        current.map((row) =>
          row.session_date === result.row.session_date ? { ...row, brief: result.row } : row,
        ),
      );
      setBriefOpen(true);
    });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Session brief</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Day-by-day AI summaries from 2 Oct 2026 onward (US trading days). Suggestions only — it
            never changes settings or trades.
          </p>
        </div>
        {!readOnly ? (
          <Button
            type="button"
            disabled={pending || !selectedDate}
            className="border border-zinc-600 bg-transparent px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-60"
            onClick={handleGenerate}
          >
            {pending
              ? "Generating…"
              : selectedBrief
                ? `Regenerate ${formatSessionDayLabel(selectedDate!)}`
                : selectedDate
                  ? `Generate ${formatSessionDayLabel(selectedDate)}`
                  : "Generate"}
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <p className="mt-4 text-sm text-amber-400/90">
          Could not load session history: {loadError}
        </p>
      ) : null}

      {chronologicalDays.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {chronologicalDays.map((day) => {
            const active = day.session_date === selectedDate;
            const mix = mixByDate.get(day.session_date);
            return (
              <button
                key={day.session_date}
                type="button"
                onClick={() => {
                  setSelectedDate(day.session_date);
                  setError(null);
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-xs transition",
                  active
                    ? "bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-700/60"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
                )}
              >
                <span className="font-medium">{formatSessionDayLabel(day.session_date)}</span>
                <span className="mt-0.5 block text-[10px] text-zinc-500">
                  {day.brief ? "Brief saved" : "No brief yet"}
                  <span className="mx-1">·</span>
                  {day.prediction_count.toLocaleString()} preds
                </span>
                {mix ? (
                  <ConditionMixLine row={mix} />
                ) : day.prediction_count > 0 && !initialMixError ? (
                  <span className="mt-0.5 block text-[10px] text-zinc-600">
                    No condition mix for this day
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No sessions since 2 Oct 2026 yet. Run the trader on a US market day, then return here.
        </p>
      )}

      {initialMixError ? (
        <p className="mt-4 text-sm text-amber-400/90">
          Could not load watchlist conditions: {initialMixError}
        </p>
      ) : null}

      {selectedMix ? (
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
          {sessionConditionCoverageNote(selectedMix.observed_minutes)}
        </p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-amber-400/90">{error}</p> : null}

      {selectedDate && !selectedBrief && !error ? (
        <p className="mt-4 text-sm text-zinc-500">
          Select a day above, then Generate to review skip reasons, near-misses, and closed trades
          for that session. Each day is saved separately so you can compare changes over time.
        </p>
      ) : null}

      {selectedBrief ? (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <button
            type="button"
            className="flex w-full items-start gap-2 text-left"
            aria-expanded={briefOpen}
            onClick={() => setBriefOpen((current) => !current)}
          >
            {briefOpen ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-200">
                {selectedBrief.brief.headline}
              </span>
              {!briefOpen ? (
                <span className="mt-1 block text-xs text-zinc-500">
                  Session {selectedBrief.session_date} · tap to expand
                </span>
              ) : null}
            </span>
          </button>

          {briefOpen ? (
            <div className="mt-4 space-y-5 pl-6">
              <div className="text-xs text-zinc-500">
                <span className="text-zinc-400">Session </span>
                {selectedBrief.session_date}
                <span className="mx-2 text-zinc-700">·</span>
                Generated {formatDateTime(selectedBrief.created_at)}
                <span className="mx-2 text-zinc-700">·</span>
                {selectedBrief.model}
              </div>
              <BriefBody brief={selectedBrief.brief} hideHeadline />
              {typeof selectedBrief.input?.settings_note === "string" ? (
                <p className="text-xs leading-relaxed text-zinc-600">
                  {selectedBrief.input.settings_note as string}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
