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
import { cn, formatCurrency, formatDateTime, formatTimeHms } from "@/lib/utils";
import type { MissedOpportunityRow, SessionBriefPacket } from "@/lib/session-brief/packet";

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

type PacketView = Partial<
  Pick<SessionBriefPacket, "trades_scope_warning" | "missed_opportunities">
> & {
  predictions?: Partial<SessionBriefPacket["predictions"]>;
  trades?: { stats?: Partial<SessionBriefPacket["trades"]["stats"]> };
};

type MissedRow = MissedOpportunityRow;

const OUTCOME_LABEL: Record<MissedRow["outcome"], string> = {
  take_profit: "Reached take-profit",
  stop_loss: "Hit stop",
  timed_out: "Timed out",
  no_data: "No price data",
};

const OUTCOME_TONE: Record<MissedRow["outcome"], string> = {
  take_profit: "bg-emerald-500/15 text-emerald-300",
  stop_loss: "bg-red-500/15 text-red-300",
  timed_out: "bg-zinc-700/40 text-zinc-300",
  no_data: "bg-zinc-800/60 text-zinc-500",
};

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-zinc-500";

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function StatStrip({ packet }: { packet: PacketView }) {
  const stats = packet.trades?.stats;
  const tiles = [
    { label: "Predictions", value: packet.predictions?.total?.toLocaleString() ?? "—" },
    { label: "Trades opened", value: packet.predictions?.traded?.toLocaleString() ?? "—" },
    {
      label: "Win rate",
      value:
        stats?.closedCount && stats.winRate != null
          ? `${Math.round(stats.winRate * 100)}%`
          : "—",
    },
    {
      label: "Net P&L",
      value: stats?.closedCount && stats.totalPnl != null ? formatCurrency(stats.totalPnl) : "—",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-md bg-zinc-900/60 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{tile.label}</p>
          <p className="mt-0.5 text-sm font-medium text-zinc-200">{tile.value}</p>
        </div>
      ))}
    </div>
  );
}

function MissedOpportunities({
  rows,
  summary,
}: {
  rows: MissedRow[];
  summary: string[];
}) {
  if (rows.length === 0 && summary.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className={SECTION_TITLE}>Skipped, but could have worked</h4>
      {summary.length > 0 ? (
        <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed text-zinc-300">
          {summary.map((line, index) => (
            <li key={`missed-${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Symbol</th>
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Jev BUY</th>
                <th className="py-1 pr-3 font-medium">Blocked by</th>
                <th className="py-1 pr-3 font-medium">What happened next</th>
                <th className="py-1 text-right font-medium">Best move</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {rows.map((row) => (
                <tr key={`${row.symbol}-${row.time}`} className="border-t border-zinc-800">
                  <td className="py-1.5 pr-3 font-medium text-zinc-200">{row.symbol}</td>
                  <td className="py-1.5 pr-3">{formatTimeHms(row.time)}</td>
                  <td className="py-1.5 pr-3">{row.buy_pct}%</td>
                  <td className="py-1.5 pr-3">{row.reason_label}</td>
                  <td className="py-1.5 pr-3">
                    <span className={cn("rounded px-1.5 py-0.5", OUTCOME_TONE[row.outcome])}>
                      {OUTCOME_LABEL[row.outcome]}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">{signedPercent(row.max_up_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-[11px] text-zinc-600">
        Rough replay on 5-minute prices after each skip, using the stop-loss, take-profit and max-hold
        settings from when this brief was generated. Not a real fill.
      </p>
    </section>
  );
}

function BriefBody({
  brief,
  input,
  hideHeadline = false,
}: {
  brief: SessionBriefContent;
  input: Record<string, unknown> | null;
  hideHeadline?: boolean;
}) {
  const packet = (input ?? {}) as PacketView;
  const missedRows = packet.missed_opportunities?.rows ?? [];
  const byReason = packet.missed_opportunities?.by_reason ?? [];
  // The model writes the blocker name freely, so match on either the label or the reason key.
  const replayFor = (reason: string) => {
    const text = reason.toLowerCase();
    return byReason.find(
      (row) => text.includes(row.label.toLowerCase()) || text.includes(row.reason.toLowerCase()),
    );
  };
  const wentWrong = brief.what_went_wrong ?? [];

  return (
    <div className="space-y-5">
      {!hideHeadline ? (
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{brief.headline}</h3>
        </div>
      ) : null}

      {packet.predictions ? <StatStrip packet={packet} /> : null}

      {packet.trades_scope_warning ? (
        <p className="text-xs text-amber-400/90">{packet.trades_scope_warning}</p>
      ) : null}

      {brief.what_happened.length > 0 || brief.exits.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {brief.what_happened.length > 0 ? (
            <section className="space-y-2">
              <h4 className={SECTION_TITLE}>What happened</h4>
              <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed text-zinc-300">
                {brief.what_happened.map((line, index) => (
                  <li key={`what-${index}`}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {brief.exits.length > 0 ? (
            <section className="space-y-2">
              <h4 className={SECTION_TITLE}>Exits</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
                {brief.exits.map((line, index) => (
                  <li key={`exit-${index}`}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {brief.entry_blockers.length > 0 ? (
        <section className="space-y-2">
          <h4 className={SECTION_TITLE}>Entry blockers</h4>
          <ul className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
            {brief.entry_blockers.map((row, index) => {
              const replay = replayFor(row.reason);
              return (
                <li
                  key={`blocker-${index}-${row.reason}`}
                  className="rounded-md bg-zinc-900/60 px-3 py-2"
                >
                  <p className="font-medium text-zinc-200">
                    {row.reason}{" "}
                    <span className="font-normal text-zinc-500">({row.count})</span>
                  </p>
                  {replay && replay.tested > 0 ? (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Replay: {replay.take_profit} reached take-profit, {replay.stop_loss} hit the
                      stop (of {replay.tested} checked)
                    </p>
                  ) : null}
                  <p className="mt-1 text-zinc-400">{row.takeaway}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <MissedOpportunities
          rows={missedRows}
          summary={brief.missed_opportunities_summary ?? []}
        />
        {wentWrong.length > 0 ? (
          <section className="space-y-2">
            <h4 className={SECTION_TITLE}>What went wrong</h4>
            <ul className="space-y-2 text-sm text-zinc-300">
              {wentWrong.map((row, index) => (
                <li key={`wrong-${index}`} className="rounded-md border border-zinc-800 px-3 py-2">
                  <p className="font-medium text-zinc-200">{row.issue}</p>
                  <p className="mt-1 text-zinc-400">{row.evidence}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {brief.suggestions.length > 0 ? (
        <section className="space-y-2">
          <h4 className={SECTION_TITLE}>Settings to review</h4>
          <ul className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2">
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
                {row.evidence ? (
                  <p className="mt-1 text-xs text-zinc-500">{row.evidence}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            Known settings can be reviewed on Settings. Applying a step still needs Save.
          </p>
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
              <BriefBody brief={selectedBrief.brief} input={selectedBrief.input} hideHeadline />
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
