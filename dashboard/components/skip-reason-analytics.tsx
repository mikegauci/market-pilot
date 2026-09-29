"use client";

import { useCallback, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchAnalyticsPredictions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  aggregateSkipReasons,
  buildSignalFunnel,
  findNearMisses,
  skipRateByHour,
  type SignalFunnel,
} from "@/lib/skip-reason-stats";
import type { Prediction } from "@/lib/types/database";
import { formatDateTime, formatPercent } from "@/lib/utils";

type Props = {
  predictions: Prediction[];
  recordThreshold: number;
  minConfidence: number;
};

function FunnelStep({
  label,
  count,
  total,
  isLast,
}: {
  label: string;
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
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500/70 transition-all"
          style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function SignalFunnelCard({ funnel }: { funnel: SignalFunnel }) {
  const base = funnel.highBuySignals || 1;
  const steps: { label: string; count: number }[] = [
    { label: "High BUY signals", count: funnel.highBuySignals },
    { label: "Trade threshold met", count: funnel.tradeEligible },
    { label: "Past confirmation", count: funnel.pastConfirmation },
    { label: "Past entry filters", count: funnel.pastFilters },
    { label: "Past risk / broker", count: funnel.pastRisk },
    { label: "Trades opened", count: funnel.traded },
  ];

  return (
    <Card>
      <CardTitle>Signal funnel</CardTitle>
      <p className="mt-1 text-xs text-zinc-600">
        From predictions with BUY above record threshold. Percentages relative to high BUY count.
      </p>
      <div className="mt-4">
        {steps.map((step, index) => (
          <FunnelStep
            key={step.label}
            label={step.label}
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
}: Props) {
  const load = useCallback(() => fetchAnalyticsPredictions(), []);
  const live = useLiveQuery(predictions, load, ["predictions"]);

  const skipBuckets = useMemo(() => aggregateSkipReasons(live).slice(0, 10), [live]);
  const funnel = useMemo(
    () => buildSignalFunnel(live, recordThreshold, minConfidence),
    [live, recordThreshold, minConfidence],
  );
  const nearMisses = useMemo(
    () => findNearMisses(live, recordThreshold, minConfidence),
    [live, recordThreshold, minConfidence],
  );
  const hourly = useMemo(() => skipRateByHour(live), [live]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SignalFunnelCard funnel={funnel} />

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
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="Count" fill="#60a5fa" />
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
        <CardTitle>Skip rate by hour</CardTitle>
        {hourly.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No prediction data</p>
        ) : (
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  tickFormatter={(h) => `${h}:00`}
                />
                <YAxis
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  domain={[0, 1]}
                />
                <Tooltip
                  formatter={(value) =>
                    `${(((value as number) ?? 0) * 100).toFixed(0)}%`
                  }
                  labelFormatter={(h) => `${h}:00`}
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="skipRate" name="Skip rate">
                  {hourly.map((entry, index) => (
                    <Cell
                      key={`${entry.hour}-${index}`}
                      fill={entry.skipRate > 0.5 ? "#f87171" : "#a78bfa"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
