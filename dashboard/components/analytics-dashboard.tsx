"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardTitle } from "@/components/ui/card";
import {
  fetchClosedTrades,
  fetchPortfolioHistory,
  fetchPredictionsForCalibration,
} from "@/lib/data-client";
import { computeJevCalibration } from "@/lib/jev-calibration";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  buildDailyEquitySeries,
  buildDailyPnlSeries,
  equityChartDomain,
  filterPortfolioByRange,
  type PortfolioRange,
} from "@/lib/portfolio-analytics";
import {
  computeTradeStats,
  exitReasonBreakdown,
  filterTradesByRange,
  pnlBySymbol,
} from "@/lib/trade-analytics";
import type { PortfolioSnapshot, Prediction, Trade } from "@/lib/types/database";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

type Props = {
  portfolioHistory: PortfolioSnapshot[];
  closedTrades: Trade[];
  currency: string;
  /** Settings → Min Jev confidence, for calibration helper copy */
  minJevConfidencePct: number;
};

const RANGE_OPTIONS: { value: PortfolioRange; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All" },
];

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color?: string }[];
  label?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 text-zinc-400">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color ?? "#e4e4e7" }}>
          {entry.name}: {valueFormatter ? valueFormatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
}

function StatFigure({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums text-zinc-100", valueClassName)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function formatChartDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function AnalyticsDashboard({
  portfolioHistory,
  closedTrades,
  currency,
  minJevConfidencePct,
}: Props) {
  const [range, setRange] = useState<PortfolioRange>("1d");

  const loadHistory = useCallback(() => fetchPortfolioHistory(), []);
  const loadTrades = useCallback(() => fetchClosedTrades(), []);
  const loadCalibrationPredictions = useCallback(
    () => fetchPredictionsForCalibration(),
    [],
  );

  const liveHistory = useLiveQuery(portfolioHistory, loadHistory, [
    "portfolio_history",
    "bot_status",
  ]);
  const liveTrades = useLiveQuery(closedTrades, loadTrades, ["trades"]);
  const livePredictions = useLiveQuery([] as Prediction[], loadCalibrationPredictions, [
    "predictions",
  ]);

  const filteredHistory = useMemo(
    () => filterPortfolioByRange(liveHistory, range),
    [liveHistory, range],
  );
  const filteredTrades = useMemo(
    () => filterTradesByRange(liveTrades, range),
    [liveTrades, range],
  );

  const dailyEquitySeries = useMemo(
    () => buildDailyEquitySeries(filteredHistory),
    [filteredHistory],
  );
  const equityChartData = useMemo(
    () =>
      dailyEquitySeries.map((p) => ({
        date: p.date,
        label: formatChartDate(p.date),
        equity: p.equity,
        changeFromPriorDay: p.changeFromPriorDay,
      })),
    [dailyEquitySeries],
  );
  const equityYDomain = useMemo(
    () => equityChartDomain(equityChartData.map((p) => p.equity)),
    [equityChartData],
  );

  const dailyPnlSeries = useMemo(() => buildDailyPnlSeries(filteredHistory), [filteredHistory]);
  const dailyChartData = useMemo(
    () =>
      dailyPnlSeries.map((p) => ({
        date: p.date,
        label: formatChartDate(p.date),
        dailyPnl: p.dailyPnl,
      })),
    [dailyPnlSeries],
  );

  const stats = useMemo(() => computeTradeStats(filteredTrades), [filteredTrades]);
  const symbolPnl = useMemo(() => pnlBySymbol(filteredTrades).slice(0, 12), [filteredTrades]);
  const exitReasons = useMemo(
    () =>
      exitReasonBreakdown(filteredTrades).map((row) => ({
        ...row,
        chartLabel: `${row.label} (${row.count})`,
      })),
    [filteredTrades],
  );
  const calibration = useMemo(
    () => computeJevCalibration(livePredictions),
    [livePredictions],
  );
  const calibrationSampleCount = useMemo(
    () => calibration.reduce((total, bucket) => total + bucket.count, 0),
    [calibration],
  );

  const profitFactorLabel =
    stats.profitFactor == null
      ? stats.closedCount === 0
        ? "—"
        : "∞"
      : stats.profitFactor.toFixed(2);

  const holdLabel =
    stats.avgHoldMinutes != null ? `${Math.round(stats.avgHoldMinutes)} min avg hold` : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {RANGE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setRange(value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition",
              range === value
                ? "bg-emerald-900/50 text-emerald-300"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatFigure
            label="Closed P&L"
            value={formatCurrency(stats.totalPnl, currency)}
            valueClassName={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
          />
          <StatFigure label="Win rate" value={formatPercent(stats.winRate)} />
          <StatFigure label="Profit factor" value={profitFactorLabel} />
          <StatFigure
            label="Expectancy"
            value={formatCurrency(stats.expectancy, currency)}
            valueClassName={stats.expectancy >= 0 ? "text-emerald-400" : "text-red-400"}
          />
          <StatFigure
            label="Avg win / loss"
            value={`${formatCurrency(stats.avgWin, currency)} / ${formatCurrency(stats.avgLoss, currency)}`}
          />
          <StatFigure
            label="Closed trades"
            value={String(stats.closedCount)}
            sub={
              holdLabel
                ? `${stats.winCount}W · ${stats.lossCount}L · ${holdLabel}`
                : `${stats.winCount}W · ${stats.lossCount}L`
            }
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Equity by day</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            End-of-day equity (last snapshot each day). Y-axis zoomed to this range; tooltip
            has exact levels and change vs the prior day.
          </p>
          {equityChartData.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No equity history for this range</p>
          ) : (
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityChartData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} />
                  <YAxis
                    domain={equityYDomain}
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    width={88}
                    tickFormatter={(v) => formatCurrency(Number(v), currency)}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0]?.payload as {
                        equity: number;
                        changeFromPriorDay: number | null;
                      };
                      return (
                        <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
                          <p className="mb-1 text-zinc-400">{label}</p>
                          <p className="text-emerald-400">
                            Equity: {formatCurrency(point.equity, currency)}
                          </p>
                          {point.changeFromPriorDay != null && (
                            <p
                              className={
                                point.changeFromPriorDay >= 0 ? "text-emerald-400" : "text-red-400"
                              }
                            >
                              vs prior day:{" "}
                              {formatCurrency(point.changeFromPriorDay, currency)}
                            </p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    name="Equity"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#34d399" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Daily P&L</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Realized + unrealized P&L for each day (last snapshot reading).
          </p>
          {dailyChartData.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No daily P&L data for this range</p>
          ) : (
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChartData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} width={70} />
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueFormatter={(v) => formatCurrency(v, currency)}
                      />
                    }
                  />
                  <Bar dataKey="dailyPnl" name="Daily P&L">
                    {dailyChartData.map((entry, index) => (
                      <Cell
                        key={`${entry.date}-${index}`}
                        fill={entry.dailyPnl >= 0 ? "#34d399" : "#f87171"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>P&L by symbol</CardTitle>
          {symbolPnl.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No closed trades in this range</p>
          ) : (
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={symbolPnl} layout="vertical">
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} />
                  <YAxis
                    type="category"
                    dataKey="symbol"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    width={50}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueFormatter={(v) => formatCurrency(v, currency)}
                      />
                    }
                  />
                  <Bar dataKey="pnl" name="P&L">
                    {symbolPnl.map((entry, index) => (
                      <Cell
                        key={`${entry.symbol}-${index}`}
                        fill={entry.pnl >= 0 ? "#34d399" : "#f87171"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>P&L by exit reason</CardTitle>
          {exitReasons.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">No closed trades in this range</p>
          ) : (
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={exitReasons} layout="vertical">
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} />
                  <YAxis
                    type="category"
                    dataKey="chartLabel"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    width={120}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueFormatter={(v) => formatCurrency(v, currency)}
                      />
                    }
                  />
                  <Bar dataKey="pnl" name="P&L">
                    {exitReasons.map((entry, index) => (
                      <Cell
                        key={`${entry.reason}-${index}`}
                        fill={entry.pnl >= 0 ? "#34d399" : "#f87171"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Jev calibration (15m forward return)</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">
          After the fact: when Jev gave a BUY score, how much did price move 15 minutes later?
          Each bar groups past predictions by BUY %; taller bars mean that bucket tended to rise
          on average.
          {calibrationSampleCount > 0
            ? ` Based on ${calibrationSampleCount.toLocaleString()} matured predictions.`
            : ""}{" "}
          Compare buckets at or above your trade cutoff ({minJevConfidencePct}% in Settings) to
          see if your min confidence is aligned. This chart does not change live trades.
        </p>
        {calibration.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            Waiting for older predictions to finish their 15-minute window and backfill forward
            returns. Bars will appear here as that backlog clears.
          </p>
        ) : (
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibration}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} unit="%" />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                  formatter={(value) => [
                    `${(typeof value === "number" ? value : Number(value ?? 0)).toFixed(3)}%`,
                    "Avg 15m return",
                  ]}
                />
                <Bar dataKey="avgReturn15m" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
