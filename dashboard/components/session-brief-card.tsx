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
import type {
  HoldCheck,
  HoldCheckRow,
  MissedOpportunityRow,
  SessionBriefPacket,
} from "@/lib/session-brief/packet";

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

const DIRECTION_TONE: Record<"raise" | "lower" | "keep", string> = {
  raise: "bg-emerald-500/15 text-emerald-300",
  lower: "bg-amber-500/15 text-amber-300",
  keep: "bg-zinc-700/40 text-zinc-300",
};

function formatSessionDayLabel(sessionDate: string): string {
  const d = new Date(`${sessionDate}T12:00:00`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

type PacketView = Partial<
  Pick<SessionBriefPacket, "trades_scope_warning" | "missed_opportunities" | "hold_check">
> & {
  predictions?: Partial<SessionBriefPacket["predictions"]>;
  trades?: { stats?: Partial<SessionBriefPacket["trades"]["stats"]> };
};

type MissedRow = MissedOpportunityRow;

const OUTCOME_LABEL: Record<MissedRow["outcome"], string> = {
  take_profit: "Would hit take-profit",
  soft_sell: "Would soft-sell",
  stop_loss: "Would hit stop",
  soft_stop: "Would soft-stop",
  timed_out: "Held to close",
  no_data: "No price data",
};

const OUTCOME_TONE: Record<MissedRow["outcome"], string> = {
  take_profit: "bg-emerald-500/15 text-emerald-300",
  soft_sell: "bg-emerald-500/10 text-emerald-300",
  stop_loss: "bg-red-500/15 text-red-300",
  soft_stop: "bg-red-500/10 text-red-300",
  timed_out: "bg-zinc-700/40 text-zinc-300",
  no_data: "bg-zinc-800/60 text-zinc-500",
};

type Tone = "sky" | "violet" | "amber" | "emerald" | "red";

// Full class strings so Tailwind can see them.
const TONES: Record<Tone, { panel: string; title: string; dot: string; marker: string }> = {
  sky: {
    panel: "border-sky-500/50 bg-sky-500/[0.04]",
    title: "text-sky-300",
    dot: "bg-sky-400",
    marker: "marker:text-sky-500",
  },
  violet: {
    panel: "border-violet-500/50 bg-violet-500/[0.04]",
    title: "text-violet-300",
    dot: "bg-violet-400",
    marker: "marker:text-violet-500",
  },
  amber: {
    panel: "border-amber-500/50 bg-amber-500/[0.04]",
    title: "text-amber-300",
    dot: "bg-amber-400",
    marker: "marker:text-amber-500",
  },
  emerald: {
    panel: "border-emerald-500/50 bg-emerald-500/[0.04]",
    title: "text-emerald-300",
    dot: "bg-emerald-400",
    marker: "marker:text-emerald-500",
  },
  red: {
    panel: "border-red-500/50 bg-red-500/[0.04]",
    title: "text-red-300",
    dot: "bg-red-400",
    marker: "marker:text-red-500",
  },
};

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section className={cn("space-y-2 rounded-md border-l-2 px-3 py-3", t.panel)}>
      <h4
        className={cn(
          "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide",
          t.title,
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} aria-hidden />
        {title}
      </h4>
      {children}
    </section>
  );
}

function moveTone(value: number | null): string {
  if (value == null || value === 0) return "text-zinc-500";
  return value > 0 ? "text-emerald-300" : "text-red-300";
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function StatStrip({ packet }: { packet: PacketView }) {
  const stats = packet.trades?.stats;
  const tiles = [
    {
      label: "Predictions",
      value: packet.predictions?.total?.toLocaleString() ?? "—",
      tone: "text-sky-300",
    },
    {
      label: "Trades opened",
      value: packet.predictions?.traded?.toLocaleString() ?? "—",
      tone: "text-violet-300",
    },
    {
      label: "Win rate",
      value:
        stats?.closedCount && stats.winRate != null
          ? `${Math.round(stats.winRate * 100)}%`
          : "—",
      tone:
        stats?.closedCount && stats.winRate != null
          ? stats.winRate >= 0.5
            ? "text-emerald-300"
            : "text-amber-300"
          : "text-zinc-200",
    },
    {
      label: "Net P&L",
      value: stats?.closedCount && stats.totalPnl != null ? formatCurrency(stats.totalPnl) : "—",
      tone:
        stats?.closedCount && stats.totalPnl != null ? moveTone(stats.totalPnl) : "text-zinc-200",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-md bg-zinc-900/60 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{tile.label}</p>
          <p className={cn("mt-0.5 text-base font-semibold", tile.tone)}>{tile.value}</p>
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
    <Section title="Skipped, but could have worked" tone="emerald">
      {summary.length > 0 ? (
        <ul
          className={cn(
            "list-inside list-disc space-y-1 text-sm leading-relaxed text-zinc-300",
            TONES.emerald.marker,
          )}
        >
          {summary.map((line, index) => (
            <li key={`missed-${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Symbol</th>
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Jev BUY</th>
                <th className="py-1 pr-3 font-medium">Blocked by</th>
                <th className="py-1 pr-3 font-medium">If it had traded</th>
                <th className="py-1 pr-3 text-right font-medium">Result</th>
                <th className="py-1 pr-3 text-right font-medium">Peak</th>
                <th className="py-1 text-right font-medium">Low</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {rows.map((row) => (
                <tr key={`${row.symbol}-${row.time}`} className="border-t border-zinc-800">
                  <td className="py-1.5 pr-3 font-medium text-zinc-200">{row.symbol}</td>
                  <td className="py-1.5 pr-3">{formatTimeHms(row.time)}</td>
                  <td
                    className={cn(
                      "py-1.5 pr-3",
                      row.buy_pct >= 90 ? "font-medium text-emerald-300" : "",
                    )}
                  >
                    {row.buy_pct}%
                  </td>
                  <td className="py-1.5 pr-3 text-amber-300/90">{row.reason_label}</td>
                  <td className="py-1.5 pr-3">
                    <span className={cn("rounded px-1.5 py-0.5", OUTCOME_TONE[row.outcome])}>
                      {OUTCOME_LABEL[row.outcome]}
                    </span>
                  </td>
                  <td className={cn("py-1.5 pr-3 text-right font-medium", moveTone(row.move_pct))}>
                    {signedPercent(row.move_pct)}
                  </td>
                  <td className={cn("py-1.5 pr-3 text-right font-medium", moveTone(row.max_up_pct))}>
                    {signedPercent(row.max_up_pct)}
                  </td>
                  <td className={cn("py-1.5 text-right font-medium", moveTone(row.max_down_pct))}>
                    {signedPercent(row.max_down_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-[11px] text-zinc-600">
        Nothing was bought. This replays 5-minute prices after each skip as if the bot had traded,
        using the stop-loss, take-profit, max-hold, soft-sell and soft-stop settings from when this
        brief was generated. Soft exits are approximated by the first bar that reaches the band, so
        the real bot (which also wants repeated hits and a Jev SELL signal) may exit later or not at
        all. Result is where that trade would have ended. Peak and Low are the highest and lowest the
        price got before that exit. Not a real fill.
      </p>
    </Section>
  );
}

function HoldTable({ title, rows }: { title: string; rows: HoldCheckRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      <table className="w-full min-w-[28rem] text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Symbol</th>
            <th className="py-1 pr-3 font-medium">Time</th>
            <th className="py-1 pr-3 font-medium">HOLD</th>
            <th className="py-1 pr-3 font-medium">If it had traded</th>
            <th className="py-1 pr-3 text-right font-medium">Result</th>
            <th className="py-1 pr-3 text-right font-medium">Peak</th>
            <th className="py-1 text-right font-medium">Low</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {rows.map((row) => (
            <tr key={`${row.symbol}-${row.time}`} className="border-t border-zinc-800">
              <td className="py-1.5 pr-3 font-medium text-zinc-200">{row.symbol}</td>
              <td className="py-1.5 pr-3">{row.time ? formatTimeHms(row.time) : "—"}</td>
              <td className="py-1.5 pr-3">{row.hold_pct}%</td>
              <td className="py-1.5 pr-3">
                <span className={cn("rounded px-1.5 py-0.5", OUTCOME_TONE[row.outcome])}>
                  {OUTCOME_LABEL[row.outcome]}
                </span>
              </td>
              <td className={cn("py-1.5 pr-3 text-right font-medium", moveTone(row.move_pct))}>
                {signedPercent(row.move_pct)}
              </td>
              <td className={cn("py-1.5 pr-3 text-right font-medium", moveTone(row.max_up_pct))}>
                {signedPercent(row.max_up_pct)}
              </td>
              <td className={cn("py-1.5 text-right font-medium", moveTone(row.max_down_pct))}>
                {signedPercent(row.max_down_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoldCheckSection({ check }: { check: HoldCheck }) {
  if (check.tested === 0) return null;
  const share = Math.round((check.profitable / check.tested) * 100);
  return (
    <Section title="If Jev's HOLD calls had been traded" tone="violet">
      <p className="text-sm leading-relaxed text-zinc-300">
        Of {check.tested} HOLD calls checked (the strongest per stock per hour),{" "}
        <span className="font-medium text-emerald-300">{check.profitable} would have made money</span>
        ,{" "}
        <span className="font-medium text-red-300">{check.losing} would have lost</span>
        {check.flat > 0 ? `, ${check.flat} would have been flat` : ""}. {share}% were winners, with an
        average result of{" "}
        <span className={cn("font-medium", moveTone(check.avg_result_pct))}>
          {signedPercent(check.avg_result_pct)}
        </span>
        . A HOLD that often would have won suggests Jev is being too cautious.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <HoldTable title="Biggest winners" rows={check.best} />
        <HoldTable title="Biggest losers" rows={check.worst} />
      </div>
      <p className="text-[11px] text-zinc-600">
        Nothing was bought. Same rough replay as above, using your stop, take-profit and soft-exit
        settings. {check.no_data > 0 ? `${check.no_data} calls had no price data and are left out. ` : ""}
        Not a real fill.
      </p>
    </Section>
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
            <Section title="What happened" tone="sky">
              <ul
                className={cn(
                  "list-inside list-disc space-y-1 text-sm leading-relaxed text-zinc-300",
                  TONES.sky.marker,
                )}
              >
                {brief.what_happened.map((line, index) => (
                  <li key={`what-${index}`}>{line}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {brief.exits.length > 0 ? (
            <Section title="Exits" tone="violet">
              <ul
                className={cn(
                  "list-inside list-disc space-y-1 text-sm text-zinc-300",
                  TONES.violet.marker,
                )}
              >
                {brief.exits.map((line, index) => (
                  <li key={`exit-${index}`}>{line}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      ) : null}

      {brief.entry_blockers.length > 0 ? (
        <Section title="Entry blockers" tone="amber">
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
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
                      {row.count}
                    </span>
                  </p>
                  {replay && replay.tested > 0 ? (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Replay:{" "}
                      <span className="text-emerald-300">{replay.take_profit + replay.soft_sell} reached take-profit</span>,{" "}
                      <span className="text-red-300">{replay.stop_loss + replay.soft_stop} hit the stop</span> (of{" "}
                      {replay.tested} checked)
                    </p>
                  ) : null}
                  <p className="mt-1 text-zinc-400">{row.takeaway}</p>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {packet.hold_check ? <HoldCheckSection check={packet.hold_check} /> : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <MissedOpportunities
          rows={missedRows}
          summary={brief.missed_opportunities_summary ?? []}
        />
        {wentWrong.length > 0 ? (
          <Section title="What went wrong" tone="red">
            <ul className="space-y-2 text-sm text-zinc-300">
              {wentWrong.map((row, index) => (
                <li
                  key={`wrong-${index}`}
                  className="rounded-md border border-red-500/30 px-3 py-2"
                >
                  <p className="font-medium text-red-200">{row.issue}</p>
                  <p className="mt-1 text-zinc-400">{row.evidence}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      {brief.suggestions.length > 0 ? (
        <Section title="Settings to review" tone="sky">
          <ul className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2">
            {brief.suggestions.map((row) => (
              <li
                key={`${row.setting}-${row.direction}`}
                className="rounded-md border border-sky-500/30 px-3 py-2"
              >
                <p className="font-medium text-zinc-100">
                  {sessionBriefSettingLabel(row.setting)}{" "}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      DIRECTION_TONE[row.direction],
                    )}
                  >
                    {directionLabel(row.direction)}
                  </span>
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
        </Section>
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
