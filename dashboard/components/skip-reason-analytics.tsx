"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SymbolDayExplanation } from "@/components/symbol-day-explanation";
import { Card, CardTitle } from "@/components/ui/card";
import { ANALYTICS_SKIP_LOOKBACK_HOURS } from "@/lib/analytics-data";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import {
  activityByHour,
  aggregateSkipReasons,
  buildSignalFunnel,
  findNearMisses,
  type SignalFunnel,
} from "@/lib/skip-reason-stats";
import { perBarTooltipProps } from "@/lib/recharts-bar-interaction";
import type { Prediction } from "@/lib/types/database";
import { formatDateTime, formatPercent } from "@/lib/utils";

type Props = {
  predictions: Prediction[];
  recordThreshold: number;
  minConfidence: number;
  sessionStartIso: string;
};

function FunnelStep({
  label,
  description,
  count,
  total,
  isLast,
}: {
  label: string;
  description: string;
  count: number;
  total: number;
  isLast?: boolean;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={isLast ? "" : "border-b border-zinc-800/60 pb-3 mb-3"}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="tabular-nums text-zinc-400">
          {count}{" "}
          <span className="text-zinc-600">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">{description}</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/70 transition-all"
          style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function SignalFunnelCard({
  funnel,
  recordThreshold,
  minConfidence,
}: {
  funnel: SignalFunnel;
  recordThreshold: number;
  minConfidence: number;
}) {
  const base = funnel.highBuySignals || 1;
  const recordPct = formatPercent(recordThreshold);
  const minPct = formatPercent(minConfidence);
  const marginPct = formatPercent(STRATEGY_FILTER_THRESHOLDS.minBuyHoldMargin);
  const steps: { label: string; description: string; count: number }[] = [
    {
      label: "High BUY signals",
      description: `BUY was the top side and ≥ ${recordPct} (record threshold). Baseline for the % below.`,
      count: funnel.highBuySignals,
    },
    {
      label: "Trade threshold met",
      description: `Cleared min confidence (${minPct}) and BUY–HOLD margin (≥ ${marginPct}).`,
      count: funnel.tradeEligible,
    },
    {
      label: "Past confirmation",
      description: "Cleared trade threshold and finished N consecutive eligible cycles.",
      count: funnel.pastConfirmation,
    },
    {
      label: "Past entry filters",
      description: "Also cleared RSI, spread, volume, EMA-20, benchmark, and news filters.",
      count: funnel.pastFilters,
    },
    {
      label: "Past risk / broker",
      description: "Also cleared position limits, capital, daily loss, and IBKR gates.",
      count: funnel.pastRisk,
    },
    {
      label: "Trades opened",
      description: "Cleared every gate and opened a position.",
      count: funnel.traded,
    },
  ];

  return (
    <Card>
      <CardTitle>Signal funnel</CardTitle>
      <p className="mt-1 text-xs text-zinc-600">
        Sequential pipeline: each stage only counts signals that cleared every earlier stage.
        Percentages are vs the High BUY baseline (first row is always 100%). Counts never increase
        down the funnel.
      </p>
      <div className="mt-4">
        {steps.map((step, index) => (
          <FunnelStep
            key={step.label}
            label={step.label}
            description={step.description}
            count={step.count}
            total={base}
            isLast={index === steps.length - 1}
          />
        ))}
      </div>
    </Card>
  );
}

export function SkipReasonAnalytics({
  predictions,
  recordThreshold,
  minConfidence,
  sessionStartIso,
}: Props) {
  const skipBuckets = useMemo(
    () => aggregateSkipReasons(predictions).slice(0, 10),
    [predictions],
  );
  const funnel = useMemo(
    () => buildSignalFunnel(predictions, recordThreshold, minConfidence),
    [predictions, recordThreshold, minConfidence],
  );
  const nearMisses = useMemo(
    () => findNearMisses(predictions, recordThreshold, minConfidence),
    [predictions, recordThreshold, minConfidence],
  );
  const hourly = useMemo(
    () => activityByHour(predictions, recordThreshold, minConfidence),
    [predictions, recordThreshold, minConfidence],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="xl:col-span-2">
        <SymbolDayExplanation
          predictions={predictions}
          sessionStartIso={sessionStartIso}
          recordThreshold={recordThreshold}
          minConfidence={minConfidence}
        />
      </div>
      <p className="text-xs text-zinc-600 xl:col-span-2">
        Skip-reason stats use up to {predictions.length.toLocaleString()} predictions from the last{" "}
        {ANALYTICS_SKIP_LOOKBACK_HOURS}h (page load). Refresh to update.
      </p>
      <SignalFunnelCard
        funnel={funnel}
        recordThreshold={recordThreshold}
        minConfidence={minConfidence}
      />

      <Card>
        <CardTitle>Top skip reasons</CardTitle>
        {skipBuckets.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No skip reasons in recent predictions</p>
        ) : (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={skipBuckets} layout="vertical">
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  width={120}
                />
                <Tooltip
                  {...perBarTooltipProps}
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Count"
                  fill="#60a5fa"
                  activeBar={{ fill: "#93c5fd", stroke: "#60a5fa", strokeWidth: 1 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Near-miss BUY signals</CardTitle>
        <p className="mt-1 text-xs text-zinc-600">
          BUY between {formatPercent(recordThreshold)} and {formatPercent(minConfidence)} — logged
          but not traded.
        </p>
        {nearMisses.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No near-misses recently</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {nearMisses.map((p) => (
              <li
                key={p.id}
                className="flex items-baseline justify-between gap-2 border-b border-zinc-800/50 pb-2 text-xs last:border-0"
              >
                <span>
                  <span className="font-medium text-zinc-200">{p.symbol}</span>
                  <span className="ml-2 text-zinc-500">{formatDateTime(p.timestamp)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-amber-400">
                  {formatPercent(p.buy_probability)}{" "}
                  <span className="text-zinc-600">
                    (−{formatPercent(p.marginToTrade)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Activity by hour (UTC)</CardTitle>
        <p className="mt-1 text-xs text-zinc-600">
          Strong BUY signals, trade-threshold hits, and trades opened — grouped by UTC clock hour.
        </p>
        {hourly.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No strong BUY signals yet</p>
        ) : (
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  tickFormatter={(h) => `${h}h`}
                  interval={2}
                />
                <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 10 }} />
                <Tooltip
                  {...perBarTooltipProps}
                  labelFormatter={(h) => `${h}:00 UTC`}
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="highBuy"
                  name="High BUY"
                  fill="#71717a"
                  activeBar={{ fill: "#a1a1aa", stroke: "#71717a", strokeWidth: 1 }}
                />
                <Bar
                  dataKey="tradeEligible"
                  name="Trade-ready"
                  fill="#60a5fa"
                  activeBar={{ fill: "#93c5fd", stroke: "#60a5fa", strokeWidth: 1 }}
                />
                <Bar
                  dataKey="traded"
                  name="Traded"
                  fill="#34d399"
                  activeBar={{ fill: "#6ee7b7", stroke: "#34d399", strokeWidth: 1 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
